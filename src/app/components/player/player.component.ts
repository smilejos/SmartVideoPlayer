import { Component, ViewChild, ElementRef, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

interface PlaylistItem {
  name: string;
  path: string;
}

@Component({
  selector: 'app-player',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="player-container">
      <!-- Video Element -->
      <video #videoPlayer class="video-element" 
             (click)="togglePlay()"
             (timeupdate)="onTimeUpdate()"
             (loadedmetadata)="onLoadedMetadata()"
             (ended)="onVideoEnded()"
             (error)="onVideoError($event)"></video>
            
      <!-- Error Message Overlay -->
      <div class="error-overlay" *ngIf="errorMessage">
        <div class="error-content">
          <span class="material-icons error-icon">warning</span>
          <p>{{ errorMessage }}</p>
          <button class="close-error" (click)="errorMessage = ''">Dismiss</button>
        </div>
      </div>

      <!-- Glassmorphism Controls -->
      <div class="controls-overlay" [class.visible]="showControls">
        <div class="progress-bar-container" (mousedown)="startSeeking($event)">
          <div class="progress-buffer"></div>
          <div class="progress-current" [style.width.%]="progress"></div>
          <div class="progress-handle" [style.left.%]="progress"></div>
        </div>

        <div class="controls-row">
          <div class="left-controls">
            <button class="icon-btn" (click)="togglePlay()">
               <span class="material-icons">{{ isPlaying ? 'pause' : 'play_arrow' }}</span>
            </button>
            <button class="icon-btn" (click)="openFile()" title="Add to Playlist">
               <span class="material-icons">add_to_photos</span>
            </button>
            <div class="time-display">
              {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
            </div>
          </div>

          <div class="center-controls">
             <button class="icon-btn" (click)="rewind()"><span class="material-icons">replay_10</span></button>
             <button class="icon-btn main-play" (click)="togglePlay()">
                <div class="play-inner">
                   <span class="material-icons">{{ isPlaying ? 'pause' : 'play_arrow' }}</span>
                </div>
             </button>
             <button class="icon-btn" (click)="forward()"><span class="material-icons">forward_10</span></button>
          </div>

          <div class="right-controls">
            <div class="speed-container">
              <button class="icon-btn speed-toggle" (click)="toggleSpeedMenu()" [class.active]="isSpeedMenuVisible">
                <span class="speed-text">{{ playbackSpeed }}x</span>
              </button>
              <div class="speed-menu" *ngIf="isSpeedMenuVisible">
                <div *ngFor="let speed of availableSpeeds" 
                     class="speed-item" 
                     [class.active]="speed === playbackSpeed"
                     (click)="setPlaybackSpeed(speed)">
                  {{ speed }}x
                </div>
              </div>
            </div>
            
            <div class="volume-container">
              <button class="icon-btn" (click)="toggleMute()">
                <span class="material-icons">{{ (volume === 0 || isMuted) ? 'volume_off' : 'volume_up' }}</span>
              </button>
              <input type="range" class="volume-slider" min="0" max="1" step="0.1" 
                     [value]="volume" (input)="onVolumeChange($event)">
            </div>
            <button class="icon-btn" (click)="togglePlaylist()" [class.active]="isPlaylistVisible">
              <span class="material-icons">featured_play_list</span>
            </button>
            <button class="icon-btn" (click)="toggleFullscreen()">
              <span class="material-icons">fullscreen</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Sliding Playlist Sidebar -->
      <div class="playlist-sidebar" [class.visible]="isPlaylistVisible">
         <div class="sidebar-header">
            <h3>Playlist</h3>
            <button class="icon-btn" (click)="togglePlaylist()"><span class="material-icons">close</span></button>
         </div>
         <div class="playlist-items">
            <div *ngFor="let item of playlist; let i = index" 
                 class="playlist-item" 
                 [class.active]="i === activeIndex"
                 (click)="playFromPlaylist(i)">
               <span class="item-number">{{ i + 1 }}</span>
               <span class="item-name">{{ item.name }}</span>
               <span *ngIf="i === activeIndex" class="playing-indicator">
                  <span class="material-icons">play_circle_filled</span>
               </span>
            </div>
            <div *ngIf="playlist.length === 0" class="empty-state">
               <p>No videos added yet</p>
               <button class="add-btn" (click)="openFile()">Add Videos</button>
            </div>
         </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100vh;
      background: var(--bg-primary);
    }

    .player-container {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      cursor: default;
    }

    .video-element {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .controls-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(transparent, rgba(0,0,0,0.85));
      padding: 40px 20px 20px;
      transition: opacity 0.3s ease;
      display: flex;
      flex-direction: column;
      gap: 15px;
      opacity: 0;
      z-index: 10;
    }

    .player-container:hover .controls-overlay {
      opacity: 1;
    }

    .progress-bar-container {
      position: relative;
      width: 100%;
      height: 4px;
      background: rgba(255,255,255,0.2);
      border-radius: 2px;
      cursor: pointer;
      transition: height 0.1s ease;
    }

    .progress-bar-container:hover {
      height: 6px;
    }

    .progress-current {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: var(--accent-primary);
      border-radius: 2px;
      box-shadow: 0 0 10px var(--accent-primary);
    }

    .progress-handle {
      position: absolute;
      top: 50%;
      width: 12px;
      height: 12px;
      background: #fff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .progress-bar-container:hover .progress-handle {
      opacity: 1;
    }

    .controls-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: white;
    }

    .icon-btn {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      padding: 8px;
      border-radius: 50%;
      transition: background 0.2s, transform 0.1s, color 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .icon-btn:hover {
      background: rgba(255,255,255,0.1);
      transform: scale(1.1);
    }

    .icon-btn.active {
      color: var(--accent-primary);
    }

    .main-play {
       background: var(--accent-primary);
       padding: 15px;
       box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);
    }

    .main-play:hover {
       background: var(--accent-secondary);
    }

    .time-display {
      font-size: 0.9rem;
      font-weight: 500;
      margin-left: 10px;
      color: var(--text-secondary);
      min-width: 100px;
    }

    .center-controls {
      display: flex;
      align-items: center;
      gap: 20px;
    }

    .right-controls {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .left-controls {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    /* Speed Control Styles */
    .speed-container {
      position: relative;
    }

    .speed-toggle {
      min-width: 45px;
      font-weight: 600;
      font-size: 0.8rem;
    }

    .speed-menu {
      position: absolute;
      bottom: 50px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--glass-bg);
      backdrop-filter: blur(20px);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-premium);
      min-width: 60px;
    }

    .speed-item {
      padding: 10px 15px;
      cursor: pointer;
      font-size: 0.9rem;
      text-align: center;
      transition: background 0.2s;
    }

    .speed-item:hover {
      background: rgba(255,255,255,0.1);
    }

    .speed-item.active {
      background: var(--accent-primary);
      color: white;
    }

    .volume-container {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .volume-slider {
      width: 0;
      opacity: 0;
      transition: width 0.3s, opacity 0.3s;
    }

    .volume-container:hover .volume-slider {
      width: 80px;
      opacity: 1;
    }

    /* Playlist Sidebar Styles */
    .playlist-sidebar {
      position: absolute;
      top: 0;
      right: -320px;
      width: 320px;
      height: 100%;
      background: var(--glass-bg);
      backdrop-filter: blur(20px);
      border-left: 1px solid var(--glass-border);
      transition: right 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 20;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-premium);
    }

    .playlist-sidebar.visible {
      right: 0;
    }

    .sidebar-header {
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--glass-border);
    }

    .playlist-items {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .playlist-item {
      padding: 12px 15px;
      border-radius: 12px;
      background: rgba(255,255,255,0.03);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: background 0.2s, transform 0.2s;
    }

    .playlist-item:hover {
      background: rgba(255,255,255,0.08);
      transform: translateX(-5px);
    }

    .playlist-item.active {
      background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
      border: 1px solid var(--accent-primary);
    }

    .item-number {
      font-size: 0.8rem;
      color: var(--text-secondary);
      min-width: 20px;
    }

    .item-name {
      flex: 1;
      font-size: 0.9rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .playing-indicator {
      color: var(--accent-primary);
    }

    .empty-state {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 15px;
      color: var(--text-secondary);
      padding: 40px;
      text-align: center;
    }

    .add-btn {
      background: var(--accent-primary);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
      transition: background 0.2s;
    }

    .add-btn:hover {
      background: var(--accent-secondary);
    }
    
    .error-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 50;
    }
    
    .error-content {
      background: var(--bg-secondary);
      padding: 30px;
      border-radius: 12px;
      text-align: center;
      border: 1px solid var(--glass-border);
      max-width: 400px;
    }
    
    .error-icon {
      font-size: 48px;
      color: #ff4444;
      margin-bottom: 15px;
    }
    
    .close-error {
      margin-top: 20px;
      padding: 8px 20px;
      background: var(--accent-primary);
      border: none;
      border-radius: 6px;
      color: white;
      cursor: pointer;
    }
  `]
})
export class PlayerComponent {
  @ViewChild('videoPlayer') videoElement!: ElementRef<HTMLVideoElement>;

  isPlaying = false;
  showControls = true;
  progress = 0;
  currentTime = 0;
  duration = 0;
  volume = 1;
  isMuted = false;

  // Playlist state
  playlist: PlaylistItem[] = [];
  activeIndex = -1;
  isPlaylistVisible = false;

  // Speed state
  playbackSpeed = 1;
  availableSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  isSpeedMenuVisible = false;

  errorMessage = '';
  serverPort = 0;

  constructor(private cdr: ChangeDetectorRef) {
    this.initServerPort();
  }

  async initServerPort() {
    this.serverPort = await (window as any).electronAPI.getServerPort();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // Prevent default scrolling for space and arrow keys
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
    }

    switch (event.key) {
      case ' ':
        this.togglePlay();
        break;
      case 'ArrowLeft':
        this.rewind();
        break;
      case 'ArrowRight':
        this.forward();
        break;
      case 'ArrowUp':
        this.volume = Math.min(1, this.volume + 0.1);
        this.videoElement.nativeElement.volume = this.volume;
        this.isMuted = false;
        break;
      case 'ArrowDown':
        this.volume = Math.max(0, this.volume - 0.1);
        this.videoElement.nativeElement.volume = this.volume;
        if (this.volume === 0) this.isMuted = true;
        break;
      case 'f':
      case 'F':
        this.toggleFullscreen();
        break;
      case 'm':
      case 'M':
        this.toggleMute();
        break;
      case '>':
      case '.':
        this.stepSpeed(1);
        break;
      case '<':
      case ',':
        this.stepSpeed(-1);
        break;
    }
    this.cdr.detectChanges();
  }

  togglePlay() {
    const video = this.videoElement.nativeElement;
    if (video.paused) {
      video.play().catch(() => { });
      this.isPlaying = true;
    } else {
      video.pause();
      this.isPlaying = false;
    }
  }

  async openFile() {
    const filePath = await (window as any).electronAPI.openFile();
    if (filePath) {
      const fileName = filePath.split(/[\\\\/]/).pop();
      const newItem = { name: fileName || 'Unknown Video', path: filePath };

      this.playlist.push(newItem);

      if (this.activeIndex === -1) {
        this.playFromPlaylist(0);
      }

      this.cdr.detectChanges();
    }
  }

  playFromPlaylist(index: number) {
    if (index < 0 || index >= this.playlist.length) return;

    this.activeIndex = index;
    this.activeIndex = index;
    const video = this.videoElement.nativeElement;

    // Use local transcoding server
    const encodedPath = encodeURIComponent(this.playlist[index].path);
    video.src = `http://127.0.0.1:${this.serverPort}/stream?path=${encodedPath}`;

    video.load();
    video.playbackRate = this.playbackSpeed; // Keep current speed
    video.play().catch(e => console.error("Play error", e));
    this.isPlaying = true;
    this.cdr.detectChanges();
  }

  onVideoEnded() {
    if (this.activeIndex < this.playlist.length - 1) {
      this.playFromPlaylist(this.activeIndex + 1);
    } else {
      this.isPlaying = false;
    }
  }

  onVideoError(event: any) {
    const video = this.videoElement.nativeElement;
    if (video.error) {
      console.error('Video Error:', video.error);
      if (video.error.code === 3) { // MEDIA_ERR_DECODE
        this.errorMessage = 'Unable to decode video. This file likely uses an unsupported codec (like HEVC/H.265). Please try an H.264 MP4 file.';
      } else if (video.error.code === 4) { // MEDIA_ERR_SRC_NOT_SUPPORTED
        this.errorMessage = 'Video format not supported or file not found.';
      } else {
        this.errorMessage = `Playback Error: ${video.error.message || 'Unknown error'}`;
      }
      this.isPlaying = false;
      this.cdr.detectChanges();
    }
  }

  togglePlaylist() {
    this.isPlaylistVisible = !this.isPlaylistVisible;
    if (this.isPlaylistVisible) this.isSpeedMenuVisible = false;
  }

  toggleSpeedMenu() {
    this.isSpeedMenuVisible = !this.isSpeedMenuVisible;
    if (this.isSpeedMenuVisible) this.isPlaylistVisible = false;
  }

  setPlaybackSpeed(speed: number) {
    this.playbackSpeed = speed;
    this.videoElement.nativeElement.playbackRate = speed;
    this.isSpeedMenuVisible = false;
  }

  stepSpeed(direction: number) {
    const currentIndex = this.availableSpeeds.indexOf(this.playbackSpeed);
    let nextIndex = currentIndex + direction;

    if (nextIndex >= 0 && nextIndex < this.availableSpeeds.length) {
      this.setPlaybackSpeed(this.availableSpeeds[nextIndex]);
    }
  }

  onTimeUpdate() {
    const video = this.videoElement.nativeElement;
    this.currentTime = video.currentTime;
    this.progress = (video.currentTime / video.duration) * 100;
    this.cdr.detectChanges();
  }

  onLoadedMetadata() {
    const video = this.videoElement.nativeElement;
    this.duration = video.duration;
    this.cdr.detectChanges();
  }

  startSeeking(event: MouseEvent) {
    const container = event.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();
    const pos = (event.clientX - rect.left) / rect.width;
    const video = this.videoElement.nativeElement;
    video.currentTime = pos * video.duration;
  }

  rewind() {
    this.videoElement.nativeElement.currentTime -= 10;
  }

  forward() {
    this.videoElement.nativeElement.currentTime += 10;
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.videoElement.nativeElement.muted = this.isMuted;
  }

  onVolumeChange(event: any) {
    this.volume = event.target.value;
    this.videoElement.nativeElement.volume = this.volume;
    if (this.volume > 0) this.isMuted = false;
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.videoElement.nativeElement.parentElement?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  formatTime(seconds: number): string {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
}
