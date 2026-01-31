const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const logFile = path.join(app.getPath('desktop'), 'vp_debug.log');

function log(message) {
    try {
        const timestamp = new Date().toISOString();
        const logMessage = `${timestamp}: ${message}\n`;
        fs.appendFileSync(logFile, logMessage);
    } catch (e) {
        console.error("Logging failed:", e);
    }
}

// Global error handler
process.on('uncaughtException', (error) => {
    log(`Uncaught Exception: ${error.stack}`);
    dialog.showErrorBox('Uncaught Exception', error.stack);
});

// Detect environment
const isPackaged = app.isPackaged;

// Determine paths for ffmpeg/ffprobe binaries
let ffmpegPath;
let ffprobePath;

try {
    log('Starting App');
    log('isPackaged: ' + isPackaged);

    if (!isPackaged) {
        ffmpegPath = require('ffmpeg-static');
        ffprobePath = require('ffprobe-static').path;
    } else {
        // In production, binaries are unpacked to resources folder
        ffmpegPath = path.join(process.resourcesPath, 'ffmpeg');
        ffprobePath = path.join(process.resourcesPath, 'ffprobe');
    }



    if (typeof ffmpegPath !== 'string') {
        log('ffmpegPath is not a string: ' + typeof ffmpegPath);
    }
    log('ffmpegPath: ' + ffmpegPath);

    try {
        log('ffmpegPath Exists: ' + fs.existsSync(ffmpegPath));
    } catch (e) { log('Error checking ffmpeg existence: ' + e.message); }

    log('ffprobePath: ' + ffprobePath);

    try {
        log('ffprobePath Exists: ' + fs.existsSync(ffprobePath));
    } catch (e) { log('Error checking ffprobe existence: ' + e.message); }

    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
} catch (err) {
    const msg = err.stack || err.message;
    log('Startup Error: ' + msg);
    dialog.showErrorBox('Startup Error', msg);
}

// Setup Express Server
const server = express();
server.use(cors());

let serverPort = 0;

server.get('/stream', (req, res) => {
    const videoPath = req.query.path;
    if (!videoPath || !fs.existsSync(videoPath)) {
        return res.status(404).send('File not found');
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const ext = path.extname(videoPath).toLowerCase();

    // Check if file is natively supported (MP4, WebM, MOV)
    // Note: MOV is a container. Chromium plays MOV if it contains H.264/AAC.
    // If it contains ProRes/HEVC, it might fail to decode in the client.
    if (ext === '.mp4' || ext === '.webm' || ext === '.mov') {
        const contentType = ext === '.webm' ? 'video/webm' : 'video/mp4';

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(videoPath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
            };
            res.writeHead(200, head);
            fs.createReadStream(videoPath).pipe(res);
        }
    } else {
        // Fallback to transcoding for unsupported formats
        // Basic transcoding setup
        // For simplicity, we stream everything as MP4 (H.264 + AAC)
        // In a production app, we'd check if transcoding is actually needed via ffprobe

        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Access-Control-Allow-Origin': '*',
        });

        const command = ffmpeg(videoPath)
            .format('mp4')
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-movflags frag_keyframe+empty_moov',
                '-pix_fmt yuv420p',
                '-preset ultrafast' // Improve start time for transcoding
            ])
            .on('start', (commandLine) => {
                console.log('[FFmpeg] Spawned Ffmpeg with command: ' + commandLine);
            })
            .on('error', (err, stdout, stderr) => {
                if (err.message.includes('Output stream closed')) {
                    console.log('[FFmpeg] Client closed connection (intentional)');
                } else {
                    console.error('[FFmpeg] Error:', err.message);
                    console.error('[FFmpeg] ffmpeg stderr:', stderr);
                }
            })
            .on('end', () => {
                console.log('[FFmpeg] Transcoding finished');
            });

        // Pipe to response
        command.pipe(res, { end: true });

        req.on('close', () => {
            console.log('[FFmpeg] Client Request closed, killing ffmpeg process');
            try {
                command.kill();
            } catch (e) {
                console.error('[FFmpeg] Error killing process:', e);
            }
        });
    }
});

const startServer = () => {
    const appListener = server.listen(0, '127.0.0.1', () => {
        serverPort = appListener.address().port;
        console.log(`Streaming server running on port ${serverPort}`);
    });
};

startServer();

// Register privileges for the custom protocol
protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } }
]);
let win;

// Register custom protocol for local media
function registerLocalResourceProtocol() {
    protocol.registerFileProtocol('media', (request, callback) => {
        const url = request.url.replace('media://', '');
        try {
            return callback(decodeURIComponent(url));
        } catch (error) {
            console.error(error);
            return callback(404);
        }
    });
}

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        titleBarStyle: 'hiddenInset' // Premium look for macOS
    });

    // Load the Angular app
    // When developing, we might want to load from localhost:4200
    // When built, we load from the dist folder
    const startUrl = process.env.ELECTRON_START_URL || url.format({
        pathname: path.join(__dirname, '../dist/videoplayer/browser/index.html'),
        protocol: 'file:',
        slashes: true
    });

    win.loadURL(startUrl);

    win.on('closed', () => {
        win = null;
    });
}

// IPC Handlers
ipcMain.handle('open-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'webm', 'mov'] }
        ]
    });

    if (!canceled && filePaths.length > 0) {
        return filePaths[0];
    }
    return null;
});

ipcMain.handle('open-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });

    if (!canceled && filePaths.length > 0) {
        const folderPath = filePaths[0];
        try {
            const files = fs.readdirSync(folderPath);
            const videoExtensions = ['.mp4', '.mkv', '.avi', '.webm', '.mov'];
            const videoFiles = files
                .filter(file => videoExtensions.includes(path.extname(file).toLowerCase()))
                .map(file => path.join(folderPath, file));
            return videoFiles;
        } catch (err) {
            console.error('Error reading directory:', err);
            return [];
        }
    }
    return [];
});

ipcMain.handle('get-video-metadata', async (event, filePath) => {
    return new Promise((resolve) => {
        try {
            log(`Getting metadata for: ${filePath}`);

            // Get file size
            const stat = fs.statSync(filePath);
            const size = stat.size;
            log(`File size: ${size}`);

            // Get metadata and thumbnail
            log('Calling ffprobe...');
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    log(`FFprobe error for ${filePath}: ${err.message}`);
                    console.error('FFprobe error:', err);
                    resolve({ duration: 0, size, thumbnail: null });
                    return;
                }

                log('FFprobe success. Duration: ' + (metadata.format.duration || 0));

                const duration = metadata.format.duration || 0;

                // Generate thumbnail
                // We'll capture a frame at 10% or 5 seconds, whichever is smaller/valid, or just 1s
                const screenshotsFolder = path.join(app.getPath('userData'), 'thumbnails');
                if (!fs.existsSync(screenshotsFolder)) {
                    fs.mkdirSync(screenshotsFolder, { recursive: true });
                }

                const filename = `thumb_${path.basename(filePath)}_${Date.now()}.png`;
                const thumbnailPath = path.join(screenshotsFolder, filename);

                log('Generating thumbnail...');
                ffmpeg(filePath)
                    .on('end', () => {
                        log('Thumbnail generated');
                        // Read the file and convert to base64
                        try {
                            const imageBuffer = fs.readFileSync(thumbnailPath);
                            const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
                            // Clean up temp file
                            fs.unlink(thumbnailPath, (err) => {
                                if (err) console.error("Error deleting temp thumbnail", err)
                            });
                            resolve({ duration, size, thumbnail: base64Image });
                        } catch (e) {
                            log('Error reading thumbnail: ' + e.message);
                            console.error('Error reading thumbnail:', e);
                            resolve({ duration, size, thumbnail: null });
                        }
                    })
                    .on('error', (err) => {
                        log('Thumbnail generation error: ' + err.message);
                        console.error('Thumbnail generation error:', err);
                        resolve({ duration, size, thumbnail: null });
                    })
                    .screenshots({
                        count: 1,
                        folder: screenshotsFolder,
                        filename: filename,
                        timemarks: ['5%'], // Capture at 5% of video
                        size: '320x180'
                    });
            });
        } catch (error) {
            log(`Error getting metadata main catch: ${error.message}`);
            console.error('Error getting metadata:', error);
            resolve({ duration: 0, size: 0, thumbnail: null });
        }
    });

});

ipcMain.handle('get-server-port', () => {
    return serverPort;
});

ipcMain.handle('select-destination-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (!canceled && filePaths.length > 0) {
        return filePaths[0];
    }
    return null;
});

ipcMain.handle('copy-video-file', async (event, { filePath, destinationFolder, pathDepth }) => {
    try {
        if (!fs.existsSync(filePath)) {
            return { success: false, message: 'Source file not found' };
        }
        if (!fs.existsSync(destinationFolder)) {
            return { success: false, message: 'Destination folder not found' };
        }

        const sourceDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        // Split by separator. On Windows it might be different, but path.sep handles system specific.
        // However, input paths might be mixed if coming from different sources, but usually consistent in Node.
        // split(path.sep) usually works.
        const pathSegments = sourceDir.split(path.sep);

        // Remove empty strings resulting from root split (e.g. /var/... -> ['', 'var', ...])
        const cleanSegments = pathSegments.filter(s => s.length > 0);

        const effectiveDepth = Math.min(Math.max(0, pathDepth), cleanSegments.length);
        const segmentsToKeep = cleanSegments.slice(cleanSegments.length - effectiveDepth);

        const targetDir = path.join(destinationFolder, ...segmentsToKeep);
        const targetPath = path.join(targetDir, fileName);

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        fs.copyFileSync(filePath, targetPath);

        return { success: true, message: `Copied to ${segmentsToKeep.join('/')}/${fileName}` };
    } catch (err) {
        console.error('Copy error:', err);
        return { success: false, message: `Copy failed: ${err.message}` };
    }
});

app.whenReady().then(() => {
    registerLocalResourceProtocol();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (win === null) {
        createWindow();
    }
});
