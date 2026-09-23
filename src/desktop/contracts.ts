export interface DesktopProject {
  path: string;
  name: string;
  sessionId: string;
}
export interface DesktopState {
  version: string;
  project?: DesktopProject;
  recent: DesktopProject[];
  credentialStorage: string;
  rememberCredentials: boolean;
}
export interface DesktopPreparation {
  dirty: number;
}
export interface DesktopBridge {
  request(action: string, data?: unknown): Promise<any>;
  state(): Promise<DesktopState>;
  openProject(recentPath?: string): Promise<DesktopState>;
  createDemo(): Promise<DesktopState>;
  closeProject(): Promise<DesktopState>;
  openDownloads(): Promise<void>;
  rememberCredentials(enabled: boolean): Promise<DesktopState>;
  onState(fn: (state: DesktopState) => void): () => void;
  onPrepare(fn: (save: boolean) => Promise<DesktopPreparation>): () => void;
}
