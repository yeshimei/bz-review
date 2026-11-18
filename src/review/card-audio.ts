/**
 * 听卡片的播放器（单例 + blob URL 生命周期）
 *
 * CardSession.render() 用 innerHTML 整体替换，模板里的 <audio> 会被销毁，
 * 所以播放器不能挂在 DOM 上：这里用类持有的单例，模板里只有按钮。
 * 换卡、停止、销毁都要释放 blob URL，否则长时间复习会持续泄漏内存。
 */
import { synthesizeSpeech, type Synthesized, type TtsConfig } from '../core/tts-client';

export interface AudioPlayerLike {
  src: string;
  onended: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
}

export interface CardAudioDeps {
  createAudio?: () => AudioPlayerLike;
  synthesize?: (text: string, cfg: TtsConfig) => Promise<Synthesized>;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

const defaultAudio = (): AudioPlayerLike => new Audio() as AudioPlayerLike;

export class CardAudio {
  private audio: AudioPlayerLike | null = null;
  private url: string | null = null;
  private key: string | null = null;
  private loading = false;

  constructor(private readonly deps: CardAudioDeps = {}) {}

  isPlaying(key?: string): boolean {
    return !!this.key && !this.loading && (!key || this.key === key);
  }

  isLoading(): boolean {
    return this.loading;
  }

  /** 同一张卡再点 = 停止；换卡 = 停旧的、播新的 */
  toggle(key: string, text: string, cfg: TtsConfig): Promise<void> {
    if (this.key === key) {
      this.stop();
      return Promise.resolve();
    }
    return this.play(key, text, cfg);
  }

  async play(key: string, text: string, cfg: TtsConfig): Promise<void> {
    this.stop();
    this.loading = true;
    try {
      const synth = this.deps.synthesize ?? synthesizeSpeech;
      const { buf, mime } = await synth(text, cfg);
      const makeUrl = this.deps.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
      const url = makeUrl(new Blob([buf], { type: mime }));
      const create = this.deps.createAudio ?? defaultAudio;
      const player = create();
      player.src = url;
      player.onended = () => this.stop();
      this.audio = player;
      this.url = url;
      this.key = key;
      await player.play();
    } finally {
      this.loading = false;
    }
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio = null;
    }
    if (this.url) {
      const revoke = this.deps.revokeObjectURL ?? ((u: string) => URL.revokeObjectURL(u));
      revoke(this.url);
      this.url = null;
    }
    this.key = null;
    this.loading = false;
  }

  dispose(): void {
    this.stop();
  }
}
