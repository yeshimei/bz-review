/**
 * 听卡片的播放器生命周期。
 *
 * render() 用 innerHTML 整体替换，DOM 里的 <audio> 会被销毁——所以播放器必须
 * 是类持有的单例，DOM 里只放按钮。这里把 blob URL 的申请/释放、播放态钉住，
 * 防换卡和退出时泄漏内存。
 */
import { describe, expect, it } from 'vitest';
import { CardAudio, type AudioPlayerLike } from '../src/review/card-audio';
import type { Synthesized } from '../src/core/tts-client';

class FakeAudio implements AudioPlayerLike {
  src = '';
  onended: (() => void) | null = null;
  played = 0;
  paused = 0;
  async play(): Promise<void> { this.played++; }
  pause(): void { this.paused++; }
}

function harness() {
  const audio = new FakeAudio();
  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;
  const sound: Synthesized = { buf: new ArrayBuffer(8), mime: 'audio/mpeg' };
  const player = new CardAudio({
    createAudio: () => audio,
    synthesize: async () => sound,
    createObjectURL: () => { const u = `blob:fake:${++seq}`; created.push(u); return u; },
    revokeObjectURL: (u) => { revoked.push(u); },
  });
  return { player, audio, created, revoked };
}

describe('听卡片 · 播放状态', () => {
  it('播放后记住当前卡片，再点同一张就是停止', async () => {
    const { player, audio } = harness();
    await player.play('c1', '原文', { url: 'http://x' });
    expect(player.isPlaying('c1')).toBe(true);
    expect(audio.played).toBe(1);
    player.toggle('c1', '原文', { url: 'http://x' });
    await Promise.resolve();
    expect(player.isPlaying()).toBe(false);
    expect(audio.paused).toBe(1);
  });

  it('播到结尾自动回到空闲，不卡在播放中', async () => {
    const { player, audio } = harness();
    await player.play('c1', '原文', { url: 'http://x' });
    audio.onended?.();
    expect(player.isPlaying()).toBe(false);
  });

  it('合成失败也不停在 loading，下一次还能点', async () => {
    const audio = new FakeAudio();
    const player = new CardAudio({
      createAudio: () => audio,
      synthesize: async () => { throw new Error('服务没开'); },
      createObjectURL: () => 'blob:x',
      revokeObjectURL: () => {},
    });
    await expect(player.play('c1', '原文', { url: 'http://x' })).rejects.toThrow('服务没开');
    expect(player.isPlaying()).toBe(false);
    expect(player.isLoading()).toBe(false);
  });
});

describe('听卡片 · blob URL 生命周期', () => {
  it('换卡时先释放上一张的 URL', async () => {
    const { player, created, revoked } = harness();
    await player.play('c1', '原文一', { url: 'http://x' });
    await player.play('c2', '原文二', { url: 'http://x' });
    expect(created).toHaveLength(2);
    expect(revoked).toEqual([created[0]]);
  });

  it('停止和销毁都释放 URL，销毁后不再持有播放器', async () => {
    const { player, created, revoked } = harness();
    await player.play('c1', '原文', { url: 'http://x' });
    player.stop();
    expect(revoked).toContain(created[0]);
    await player.play('c1', '原文', { url: 'http://x' });
    player.dispose();
    expect(revoked).toHaveLength(2);
    expect(player.isPlaying()).toBe(false);
  });

  it('没播过就停止也不抛错', () => {
    expect(() => harness().player.stop()).not.toThrow();
  });
});
