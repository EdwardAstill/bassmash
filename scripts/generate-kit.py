"""Generate starter kit samples using synthesis."""
import struct
import math
import os
import wave

KIT_DIR = os.path.join(os.path.dirname(__file__), '..', 'kit')
SAMPLE_RATE = 44100

def write_wav(filename, samples, sample_rate=SAMPLE_RATE):
    path = os.path.join(KIT_DIR, filename)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        for s in samples:
            clamped = max(-1.0, min(1.0, s))
            w.writeframes(struct.pack('<h', int(clamped * 32767)))

def kick_punchy():
    n = int(SAMPLE_RATE * 0.4); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; freq = 150 * math.exp(-t * 10) + 40; env = math.exp(-t * 8)
        samples.append(math.sin(2 * math.pi * freq * t) * env * 0.9)
    return samples

def kick_deep():
    n = int(SAMPLE_RATE * 0.5); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; freq = 80 * math.exp(-t * 6) + 30; env = math.exp(-t * 5)
        samples.append(math.sin(2 * math.pi * freq * t) * env * 0.95)
    return samples

def kick_acoustic():
    n = int(SAMPLE_RATE * 0.35); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; freq = 200 * math.exp(-t * 15) + 50; env = math.exp(-t * 10)
        noise = (hash(i) % 2000 - 1000) / 1000.0
        samples.append((math.sin(2 * math.pi * freq * t) * 0.8 + noise * 0.2 * math.exp(-t * 30)) * env)
    return samples

def snare_crisp():
    n = int(SAMPLE_RATE * 0.25); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; tone = math.sin(2 * math.pi * 200 * t) * math.exp(-t * 20)
        noise = (hash(i * 7) % 2000 - 1000) / 1000.0 * math.exp(-t * 12)
        samples.append((tone * 0.4 + noise * 0.6) * 0.9)
    return samples

def snare_clap():
    n = int(SAMPLE_RATE * 0.3); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; noise = (hash(i * 13) % 2000 - 1000) / 1000.0; env = math.exp(-t * 10)
        burst = sum(math.exp(-(t - d) * 100) for d in [0, 0.01, 0.02] if t >= d)
        samples.append(noise * env * min(burst, 1) * 0.8)
    return samples

def snare_rimshot():
    n = int(SAMPLE_RATE * 0.15); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; tone = math.sin(2 * math.pi * 400 * t) * math.exp(-t * 30)
        click = math.exp(-t * 200); samples.append((tone * 0.5 + click * 0.5) * 0.9)
    return samples

def hihat_closed():
    n = int(SAMPLE_RATE * 0.08); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; noise = (hash(i * 17) % 2000 - 1000) / 1000.0; env = math.exp(-t * 60)
        hp = math.sin(2 * math.pi * 8000 * t) + math.sin(2 * math.pi * 10000 * t)
        samples.append((noise * 0.6 + hp * 0.4) * env * 0.5)
    return samples

def hihat_open():
    n = int(SAMPLE_RATE * 0.4); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; noise = (hash(i * 19) % 2000 - 1000) / 1000.0; env = math.exp(-t * 6)
        hp = math.sin(2 * math.pi * 8000 * t) + math.sin(2 * math.pi * 11000 * t)
        samples.append((noise * 0.6 + hp * 0.4) * env * 0.5)
    return samples

def hihat_pedal():
    n = int(SAMPLE_RATE * 0.12); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; noise = (hash(i * 23) % 2000 - 1000) / 1000.0; env = math.exp(-t * 35)
        samples.append(noise * env * 0.4)
    return samples

def bass_808(freq=55):
    n = int(SAMPLE_RATE * 0.8); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; pitch = freq * (1 + 0.5 * math.exp(-t * 20)); env = math.exp(-t * 3)
        s = math.sin(2 * math.pi * pitch * t) * env; s = max(-0.8, min(0.8, s * 1.5))
        samples.append(s)
    return samples

def shaker():
    n = int(SAMPLE_RATE * 0.1); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; noise = (hash(i * 31) % 2000 - 1000) / 1000.0
        env = math.exp(-t * 30) * math.sin(math.pi * t / 0.1); samples.append(noise * env * 0.3)
    return samples

def cowbell():
    n = int(SAMPLE_RATE * 0.3); samples = []
    for i in range(n):
        t = i / SAMPLE_RATE; tone = (math.sin(2 * math.pi * 587 * t) + math.sin(2 * math.pi * 845 * t)) * 0.5
        env = math.exp(-t * 12); samples.append(tone * env * 0.6)
    return samples

if __name__ == '__main__':
    os.makedirs(KIT_DIR, exist_ok=True)
    kit = {
        'kick-punchy.wav': kick_punchy(), 'kick-deep.wav': kick_deep(), 'kick-acoustic.wav': kick_acoustic(),
        'snare-crisp.wav': snare_crisp(), 'snare-clap.wav': snare_clap(), 'snare-rimshot.wav': snare_rimshot(),
        'hihat-closed.wav': hihat_closed(), 'hihat-open.wav': hihat_open(), 'hihat-pedal.wav': hihat_pedal(),
        '808-bass-C1.wav': bass_808(32.7), '808-bass-E1.wav': bass_808(41.2), '808-bass-A1.wav': bass_808(55),
        'perc-shaker.wav': shaker(), 'perc-cowbell.wav': cowbell(),
    }
    for filename, samples in kit.items():
        write_wav(filename, samples)
        print(f'  Generated {filename} ({len(samples)} samples)')
    print(f'\nDone — {len(kit)} samples in {KIT_DIR}')
