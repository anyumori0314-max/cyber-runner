// ===================================
// audio/audio-manager.js — Web Audio による効果音（Stage 2）
//
// 責務: AudioContext の初期化 / 効果音再生 / ミュート切替 / suspended からの再開。
// サウンド名・音量・周波数・再生タイミングは script.js 当時の実装と同一（挙動不変）。
// 外部依存なし（window.AudioContext / console のみ）。自己完結のため単一エクスポート。
// ===================================

// AudioManager: Web Audio で簡易的な効果音を生成
export const AudioManager = {
    ctx: null,
    master: null,
    muted: false,
    init() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.muted ? 0 : 0.18;
            this.master.connect(this.ctx.destination);
        } catch (e) {
            console.warn('Audio init failed', e);
        }
    },
    toggleMute() {
        this.muted = !this.muted;
        if (this.master) this.master.gain.value = this.muted ? 0 : 0.18;
    },
    play(name) {
        if (!this.ctx) return;
        try {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            const t = this.ctx.currentTime;
            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.connect(g);
            g.connect(this.master);
            // 簡易な音色定義
            if (name === 'start') {
                o.type = 'sine';
                o.frequency.setValueAtTime(880, t);
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
                o.start(t);
                o.stop(t + 0.3);
            } else if (name === 'levelUp') {
                o.type = 'triangle';
                o.frequency.setValueAtTime(660, t);
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
                o.start(t);
                o.stop(t + 0.22);
            } else if (name === 'pickup') {
                o.type = 'sawtooth';
                o.frequency.setValueAtTime(1200, t);
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(0.08, t + 0.005);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
                o.start(t);
                o.stop(t + 0.16);
            } else if (name === 'gameover') {
                o.type = 'sine';
                o.frequency.setValueAtTime(200, t);
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
                o.start(t);
                o.stop(t + 0.7);
            }
        } catch (e) {
            console.warn('Audio play failed', e);
        }
    }
};
