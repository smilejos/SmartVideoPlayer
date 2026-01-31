import { Component, ViewChild, ElementRef, ChangeDetectorRef, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface PlaylistItem {
  name: string;
  path: string;
  duration?: number;
  size?: number;
  thumbnail?: string;
  width?: number;
  height?: number;
  mtime?: number;
  creation_time?: string;
  location?: string;
}

@Component({
  selector: 'app-player',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="player-container">
      <!-- Drag Handle for Electron Window -->
      <div class="drag-handle"></div>

      <!-- Video Element -->
      <video #videoPlayer class="video-element"
        (click)="togglePlay()"
        (timeupdate)="onTimeUpdate()"
        (loadedmetadata)="onLoadedMetadata()"
        (ended)="onVideoEnded()"
        (error)="onVideoError($event)">
      </video>

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
            <button class="icon-btn" (click)="openFolder()" title="Open Folder">
              <span class="material-icons">create_new_folder</span>
            </button>
            <div class="time-display">
              {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
            </div>
          </div>

          <div class="center-controls">
            <button class="icon-btn" (click)="rewind()" title="Rewind">
              <span class="material-icons">replay_10</span>
            </button>
            <button class="icon-btn main-play" (click)="togglePlay()">
              <div class="play-inner">
                <span class="material-icons">{{ isPlaying ? 'pause' : 'play_arrow' }}</span>
              </div>
            </button>
            <button class="icon-btn" (click)="forward()" title="Forward">
              <span class="material-icons">forward_10</span>
            </button>
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
          <div class="header-actions">
             <button class="icon-btn" (click)="toggleConfig()" title="Settings" [class.active]="isConfigVisible">
                <span class="material-icons">tune</span>
             </button>
             <button class="icon-btn" (click)="clearPlaylist()" title="Clear Playlist">
                <span class="material-icons">delete_sweep</span>
             </button>
             <button class="icon-btn" (click)="togglePlaylist()">
                <span class="material-icons">close</span>
             </button>
          </div>
        </div>

        <div class="config-toolbar" *ngIf="isConfigVisible">
            <div class="config-item">
                <span class="config-label">Min Dur:</span>
                <input type="number" [(ngModel)]="minDuration" (ngModelChange)="saveConfig()" min="0" class="config-input" title="Filter videos shorter than X seconds">
                <span class="config-unit">s</span>
            </div>
            <div class="config-item">
                <span class="config-label">Seek:</span>
                <input type="number" [(ngModel)]="seekSeconds" (ngModelChange)="saveConfig()" min="1" class="config-input" title="Seek interval in seconds">
                <span class="config-unit">s</span>
            </div>
            
            <div class="config-separator"></div>

            <div class="config-item">
                <span class="config-label">Dest:</span>
                <div class="dest-input-group">
                    <input type="text" [value]="copyDestination" readonly class="config-input dest-input" placeholder="Select folder..." title="{{copyDestination}}">
                    <button class="icon-btn small" (click)="selectDestination()" title="Select Destination Folder">
                        <span class="material-icons" style="font-size: 16px;">folder_open</span>
                    </button>
                </div>
            </div>
            <div class="config-item">
                <span class="config-label">Depth:</span>
                <input type="number" [(ngModel)]="copyDepth" (ngModelChange)="saveConfig()" min="0" class="config-input" title="Path depth to preserve">
            </div>
            <div class="config-item">
                <span class="config-label" style="width:auto">Cache Thumbnails:</span>
                <input type="checkbox" [(ngModel)]="cacheThumbnails" (change)="saveConfig()" title="Save thumbnails to .thumbnails folder in video directory">
            </div>
        </div>

        <div class="playlist-items">
          <div *ngFor="let item of playlist; let i = index" 
               [id]="'playlist-item-' + i"
               class="playlist-item" 
               [class.active]="i === activeIndex"
               [style.display]="shouldShow(item) ? 'flex' : 'none'"
               (click)="playFromPlaylist(i)">
            <div class="item-thumbnail">
              <img [src]="item.thumbnail" *ngIf="item.thumbnail" alt="thumb">
              <span class="material-icons placeholder-icon" *ngIf="!item.thumbnail">movie</span>
            </div>
            <div class="item-details">
              <div class="item-row">
                <span class="item-number">{{ i + 1 }}</span>
                <span class="item-name">{{ item.name }}</span>
              </div>
              <div class="item-meta">
                <span>{{ formatTime(item.duration || 0) }}</span>
                <span class="meta-dot">•</span>
                <span>{{ formatSize(item.size || 0) }}</span>
              </div>
            </div>
            <span *ngIf="i === activeIndex" class="playing-indicator">
              <span class="material-icons">play_circle_filled</span>
            </span>
          </div>
          
          <div *ngIf="playlist.length === 0" class="empty-state">
            <p>No videos added yet</p>
            <button class="add-btn" (click)="openFolder()">Open Folder</button>
            <button class="add-btn secondary" (click)="openFile()">Add Files</button>
          </div>
        </div>
      </div>
      
      <div class="toast-notification" *ngIf="toastMessage" [class.show]="toastMessage">
        {{ toastMessage }}
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
      background: black;
    }

    /* Drag Handle */
    .drag-handle {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 32px; /* Standard macOS title bar height */
      z-index: 1000;
      -webkit-app-region: drag;
    }

    /* Controls Overlay */
    .controls-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(to top, rgba(0,0,0,0.9), transparent);
      padding: 20px;
      opacity: 0;
      transition: opacity 0.3s ease;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .controls-overlay.visible {
      opacity: 1;
    }

    /* Progress Bar */
    .progress-bar-container {
      position: relative;
      width: 100%;
      height: 6px;
      background: rgba(255,255,255,0.2);
      border-radius: 3px;
      cursor: pointer;
      transition: height 0.2s;
    }

    .progress-bar-container:hover {
      height: 8px;
    }

    .progress-current {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      background: var(--accent-primary);
      border-radius: 3px;
    }

    .progress-handle {
      position: absolute;
      top: 50%;
      width: 12px;
      height: 12px;
      background: white;
      border-radius: 50%;
      transform: translate(-50%, -50%) scale(0);
      transition: transform 0.2s;
    }

    .progress-bar-container:hover .progress-handle {
      transform: translate(-50%, -50%) scale(1);
    }

    /* Controls Row */
    .controls-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 50px;
    }

    .left-controls, .center-controls, .right-controls {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .center-controls {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
    }

    .icon-btn {
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 8px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .icon-btn:hover, .icon-btn.active {
      color: white;
      background: rgba(255,255,255,0.1);
    }

    .icon-btn.main-play {
      background: white;
      color: black;
      width: 48px;
      height: 48px;
      padding: 0;
    }

    .icon-btn.main-play:hover {
      transform: scale(1.1);
      background: white;
    }

    .time-display {
      color: white;
      font-size: 14px;
      font-weight: 500;
      margin-left: 10px;
      font-variant-numeric: tabular-nums;
    }

    /* Volume */
    .volume-container {
      display: flex;
      align-items: center;
      gap: 5px;
      width: 120px;
    }

    .volume-slider {
      width: 100%;
      height: 4px;
      -webkit-appearance: none;
      background: rgba(255,255,255,0.3);
      border-radius: 2px;
      outline: none;
    }
    
    .volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      background: white;
      border-radius: 50%;
      cursor: pointer;
    }

    /* Speed Menu */
    .speed-container {
      position: relative;
    }

    .speed-text {
      font-size: 14px;
      font-weight: 600;
      width: 30px;
      text-align: center;
    }

    .speed-menu {
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(20,20,30,0.95);
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      padding: 5px;
      margin-bottom: 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      backdrop-filter: blur(10px);
    }

    .speed-item {
      padding: 6px 16px;
      color: var(--text-secondary);
      cursor: pointer;
      border-radius: 4px;
      font-size: 13px;
      white-space: nowrap;
    }

    .speed-item:hover {
      background: rgba(255,255,255,0.1);
      color: white;
    }

    .speed-item.active {
      color: var(--accent-primary);
      font-weight: bold;
    }

    /* Playlist Sidebar */
    .playlist-sidebar {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 320px;
      background: rgba(15,15,20,0.95);
      backdrop-filter: blur(15px);
      border-left: 1px solid var(--glass-border);
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
      z-index: 20;
    }

    .playlist-sidebar.visible {
      transform: translateX(0);
    }

    .sidebar-header {
      padding: 20px;
      border-bottom: 1px solid var(--glass-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .sidebar-header h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: white;
    }

    .header-actions {
        display: flex;
        gap: 8px;
    }

    /* Config Toolbar */
    .config-toolbar {
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.03);
        border-bottom: 1px solid var(--glass-border);
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .config-separator {
        height: 1px;
        background: var(--glass-border);
        width: 100%;
        margin: 4px 0;
    }

    .config-item {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: space-between;
    }

    .config-label {
        font-size: 12px;
        color: var(--text-secondary);
        min-width: 50px;
    }

    .config-input {
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid var(--glass-border);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        width: 60px;
        text-align: right;
    }

    .config-unit {
        font-size: 12px;
        color: var(--text-secondary);
        width: 15px;
    }

    .dest-input-group {
        display: flex;
        align-items: center;
        gap: 5px;
        flex: 1;
    }

    .dest-input {
        flex: 1;
        width: auto;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        overflow: hidden;
        cursor: pointer;
    }

   .icon-btn.small {
        padding: 4px;
        width: 24px;
        height: 24px;
        background: rgba(255,255,255,0.1);
        border-radius: 4px;
    }
    
    .icon-btn.small:hover {
        background: rgba(255,255,255,0.2);
    }

    .playlist-items {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
    }

    .playlist-item {
      display: flex;
      gap: 12px;
      padding: 10px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .playlist-item:hover {
      background: rgba(255,255,255,0.05);
    }

    .playlist-item.active {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.1);
    }

    .item-thumbnail {
      width: 80px;
      height: 45px;
      background: black;
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .item-thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    .placeholder-icon {
      color: #555;
    }

    .item-details {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      overflow: hidden;
    }

    .item-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 4px;
    }

    .item-number {
      color: var(--text-secondary);
      font-size: 12px;
      font-family: monospace;
    }

    .item-name {
      color: white;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-meta {
      display: flex;
      gap: 6px;
      align-items: center;
      color: var(--text-secondary);
      font-size: 11px;
    }

    .meta-dot {
      font-size: 8px;
      opacity: 0.5;
    }

    .playing-indicator {
      color: var(--accent-primary);
      display: flex;
      align-items: center;
    }

    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: var(--text-secondary);
    }

    .add-btn {
      margin-top: 15px;
      background: var(--accent-primary);
      color: white;
      border: none;
      padding: 8px 20px;
      border-radius: 20px;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .add-btn.secondary {
        background: rgba(255,255,255,0.1);
        margin-left: 10px;
    }

    .add-btn:hover {
      filter: brightness(1.1);
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 6px;
    }

    ::-webkit-scrollbar-track {
      background: transparent;
    }

    ::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.2);
      border-radius: 3px;
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
    
    .toast-notification {
        position: absolute;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(0, 0, 0, 0.85);
        color: white;
        padding: 10px 20px;
        border-radius: 25px;
        font-size: 14px;
        opacity: 0;
        transition: all 0.3s ease;
        border: 1px solid var(--glass-border);
        pointer-events: none;
        z-index: 100;
        white-space: nowrap;
    }
    
    .toast-notification.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }
  `]
})
export class PlayerComponent implements OnInit {
  @ViewChild('videoPlayer') videoElement!: ElementRef<HTMLVideoElement>;

  isPlaying = false;
  showControls = true;
  progress = 0;
  currentTime = 0;
  duration = 0;
  volume = 1;
  isMuted = false;

  // Config state
  minDuration = 0;
  seekSeconds = 10;
  isConfigVisible = false;
  cacheThumbnails = false;

  // Copy state
  copyDestination = '';
  copyDepth = 2;
  toastMessage = '';
  toastTimeout: any;

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

  ngOnInit() {
    this.loadConfig();
  }

  saveConfig() {
    const config = {
      minDuration: this.minDuration,
      seekSeconds: this.seekSeconds,
      copyDestination: this.copyDestination,
      copyDepth: this.copyDepth,
      cacheThumbnails: this.cacheThumbnails
    };
    localStorage.setItem('playerConfig', JSON.stringify(config));
  }

  loadConfig() {
    const saved = localStorage.getItem('playerConfig');
    if (saved) {
      try {
        const config = JSON.parse(saved);
        if (config.minDuration !== undefined) this.minDuration = config.minDuration;
        if (config.seekSeconds !== undefined) this.seekSeconds = config.seekSeconds;
        if (config.copyDestination !== undefined) this.copyDestination = config.copyDestination;
        if (config.copyDepth !== undefined) this.copyDepth = config.copyDepth;
        if (config.cacheThumbnails !== undefined) this.cacheThumbnails = config.cacheThumbnails;
      } catch (e) {
        console.error('Failed to load config', e);
      }
    }
  }

  async initServerPort() {
    this.serverPort = await (window as any).electronAPI.getServerPort();
  }

  shouldShow(item: PlaylistItem): boolean {
    if (!this.minDuration) return true;
    return (item.duration || 0) >= this.minDuration;
  }

  getNextIndex(currentIndex: number, direction: number): number {
    let nextIndex = currentIndex + direction;
    while (nextIndex >= 0 && nextIndex < this.playlist.length) {
      if (this.shouldShow(this.playlist[nextIndex])) {
        return nextIndex;
      }
      nextIndex += direction;
    }
    return -1; // No valid next/prev item
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
        {
          const prev = this.getNextIndex(this.activeIndex, -1);
          if (prev !== -1) this.playFromPlaylist(prev);
        }
        break;
      case 'ArrowDown':
        {
          const next = this.getNextIndex(this.activeIndex, 1);
          if (next !== -1) this.playFromPlaylist(next);
        }
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
      case 'c':
      case 'C':
        this.copyCurrentVideo();
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
      const metadata = await (window as any).electronAPI.getVideoMetadata(filePath, { cacheThumbnails: this.cacheThumbnails });

      const newItem: PlaylistItem = {
        name: fileName || 'Unknown Video',
        path: filePath,
        ...metadata
      };

      this.playlist.push(newItem);

      if (this.activeIndex === -1) {
        this.playFromPlaylist(0);
      }

      this.cdr.detectChanges();
    }
  }

  async openFolder() {
    const items = await (window as any).electronAPI.openFolder();
    if (items && items.length > 0) {
      // items is now Array<{path, size, mtime}>

      const folderPath = items[0].path.substring(0, items[0].path.lastIndexOf((window as any).electronAPI.isWindows ? '\\' : '/'));

      // 1. Read Cache
      let metadataCache = new Map<string, PlaylistItem>();
      if (this.cacheThumbnails) {
        const cachedData = await (window as any).electronAPI.readMetadataCache(folderPath);
        if (Array.isArray(cachedData)) {
          cachedData.forEach((item: PlaylistItem) => {
            if (item.path) metadataCache.set(item.path, item);
          });
        }
      }

      const newItems: PlaylistItem[] = items.map((item: any) => ({
        name: item.path.split(/[\\\\/]/).pop(),
        path: item.path,
        size: item.size,
        mtime: item.mtime
      }));

      // Combine with existing playlist
      // Check for duplicates
      const uniqueNewItems = newItems.filter(newItem =>
        !this.playlist.some(existing => existing.path === newItem.path)
      );

      const startIndex = this.playlist.length;
      this.playlist = [...this.playlist, ...uniqueNewItems];
      this.isPlaylistVisible = true;

      // Play the first new item if playlist was empty
      if (this.activeIndex === -1 && this.playlist.length > 0) {
        this.playFromPlaylist(0);
      }
      this.cdr.detectChanges();

      // Fetch metadata in background
      let cacheDirty = false;
      const processList = uniqueNewItems; // Only process what we just added

      for (let i = 0; i < processList.length; i++) {
        const item = processList[i];
        const globalIndex = this.playlist.findIndex(p => p.path === item.path);
        if (globalIndex === -1) continue;

        // Check Cache
        let metadata: any = null;
        if (this.cacheThumbnails) {
          const cached = metadataCache.get(item.path);
          // Validate cache (check size and mtime)
          // Allow small tolerance for mtime (e.g. 100ms) or exact match
          if (cached && cached.size === item.size) {
            // If mtime is available in both, check it. Legacy cache might not have mtime.
            if (!cached.mtime || !item.mtime || Math.abs(cached.mtime - item.mtime) < 1000) {
              metadata = cached;
              // console.log('Cache hit for', item.name);
            }
          }
        }

        if (!metadata) {
          // Cache Miss or Invalid - Fetch fresh
          metadata = await (window as any).electronAPI.getVideoMetadata(item.path, { cacheThumbnails: this.cacheThumbnails });
          cacheDirty = true;
        }

        // Merge metadata (keeping size/mtime from fs if needed, but metadata usually has accurate duration/dims)
        this.playlist[globalIndex] = { ...this.playlist[globalIndex], ...metadata };

        // Force update UI every few items to be responsive
        if (i % 5 === 0 || i === processList.length - 1) {
          this.cdr.detectChanges();
        }
      }

      // Write Cache Back
      if (this.cacheThumbnails && cacheDirty) {
        // We can write the entire playlist metadata to the cache file of this folder
        // Filter playlist to only items in this folder to avoid mixing? 
        // For now, assuming user opens one folder. 
        // Better: Only write entries that belong to this folderPath.
        const folderItems = this.playlist.filter(p => p.path.startsWith(folderPath));
        (window as any).electronAPI.writeMetadataCache(folderPath, folderItems);
      }
    }
  }

  playFromPlaylist(index: number) {
    if (index < 0 || index >= this.playlist.length) return;

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
    this.scrollToActive();
  }

  scrollToActive() {
    setTimeout(() => {
      const element = document.getElementById(`playlist-item-${this.activeIndex}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 50); // Small delay to ensure DOM is updated
  }

  onVideoEnded() {
    const next = this.getNextIndex(this.activeIndex, 1);
    if (next !== -1) {
      this.playFromPlaylist(next);
    } else {
      this.isPlaying = false;
    }
  }

  onVideoError(event: any) {
    // Ignore errors if playlist is empty (e.g. when cleared)
    if (this.playlist.length === 0) {
      this.errorMessage = '';
      return;
    }

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

  clearPlaylist() {
    this.playlist = [];
    this.activeIndex = -1;
    this.isPlaying = false;
    this.videoElement.nativeElement.src = '';
    this.currentTime = 0;
    this.progress = 0;
    this.duration = 0;
    this.errorMessage = ''; // Clear any existing errors
    this.cdr.detectChanges();
  }

  toggleSpeedMenu() {
    this.isSpeedMenuVisible = !this.isSpeedMenuVisible;
    if (this.isSpeedMenuVisible) this.isPlaylistVisible = false;
  }

  toggleConfig() {
    this.isConfigVisible = !this.isConfigVisible;
  }

  async selectDestination() {
    const path = await (window as any).electronAPI.selectDestinationFolder();
    if (path) {
      this.copyDestination = path;
      this.saveConfig();
      this.cdr.detectChanges();
    }
  }

  async copyCurrentVideo() {
    if (!this.playlist[this.activeIndex] || !this.copyDestination) {
      this.showToast('Please select a video and a destination folder first.', true);
      return;
    }

    const currentVideo = this.playlist[this.activeIndex];
    this.showToast('Copying...');

    // Determine orientation
    let orientation = '';
    if (currentVideo.width && currentVideo.height) {
      orientation = currentVideo.width >= currentVideo.height ? 'H' : 'V';
    }

    const result = await (window as any).electronAPI.copyVideoFile(
      currentVideo.path,
      this.copyDestination,
      this.copyDepth,
      orientation
    );

    this.showToast(result.message, !result.success);
  }

  showToast(message: string, isError = false) {
    this.toastMessage = message;
    // You might want to add a class for error, but for now simple message
    // If we want error styling, we can add toastIsError state or prefix message
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage = '';
      this.cdr.detectChanges();
    }, 3000);
    this.cdr.detectChanges();
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
    this.videoElement.nativeElement.currentTime -= this.seekSeconds;
  }

  forward() {
    this.videoElement.nativeElement.currentTime += this.seekSeconds;
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

  formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
