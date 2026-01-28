const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');

// Detect ffmpeg path (assuming it's in PATH, otherwise set explicitly)
ffmpeg.setFfmpegPath('ffmpeg');

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
            // Get file size
            const stat = fs.statSync(filePath);
            const size = stat.size;

            // Get metadata and thumbnail
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    console.error('FFprobe error:', err);
                    resolve({ duration: 0, size, thumbnail: null });
                    return;
                }

                const duration = metadata.format.duration || 0;

                // Generate thumbnail
                // We'll capture a frame at 10% or 5 seconds, whichever is smaller/valid, or just 1s
                const screenshotsFolder = path.join(app.getPath('userData'), 'thumbnails');
                if (!fs.existsSync(screenshotsFolder)) {
                    fs.mkdirSync(screenshotsFolder, { recursive: true });
                }

                const filename = `thumb_${path.basename(filePath)}_${Date.now()}.png`;
                const thumbnailPath = path.join(screenshotsFolder, filename);

                ffmpeg(filePath)
                    .on('end', () => {
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
                            console.error('Error reading thumbnail:', e);
                            resolve({ duration, size, thumbnail: null });
                        }
                    })
                    .on('error', (err) => {
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
            console.error('Error getting metadata:', error);
            resolve({ duration: 0, size: 0, thumbnail: null });
        }
    });

});

ipcMain.handle('get-server-port', () => {
    return serverPort;
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
