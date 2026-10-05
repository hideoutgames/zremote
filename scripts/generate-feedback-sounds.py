"""Generate ZRemote's original, quiet sine-dot UI cues (no external samples)."""
import math
import struct
import wave
from pathlib import Path

RATE = 44100
# (onset, pitch, duration, gain). Rounded attacks avoid clicks; the faint
# harmonic and short tail give each dot a soft glass-like character.
CUES = {
    "send": [(0, 740, .13, .20), (.065, 1110, .17, .13)],
    "voiceStart": [(0, 440, .14, .17), (.085, 660, .20, .16)],
    "voiceFinish": [(0, 660, .13, .15), (.075, 440, .19, .14)],
    "refresh": [(0, 830, .12, .15), (.065, 622, .12, .13), (.13, 932, .18, .13)],
    "finished": [(0, 554, .19, .16), (.105, 831, .24, .15), (.19, 1108, .27, .10)],
}


def generate(destination: Path):
    for name, notes in CUES.items():
        frames = []
        for index in range(math.ceil(max(start + duration for start, _, duration, _ in notes) * RATE)):
            time = index / RATE
            value = 0.0
            for start, pitch, duration, gain in notes:
                t = time - start
                if 0 <= t < duration:
                    attack = min(1, t / .009)
                    release = min(1, (duration - t) / .045)
                    envelope = math.sin(attack * math.pi / 2) ** 2 * release ** 2 * math.exp(-t * 17)
                    value += gain * envelope * (math.sin(2 * math.pi * pitch * t) + .10 * math.sin(2 * math.pi * pitch * 2 * t))
            frames.append(struct.pack('<h', round(max(-1, min(1, value)) * 32767)))
        with wave.open(str(destination / f'feedback-{name}.wav'), 'wb') as output:
            output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
            output.writeframes(b''.join(frames))


if __name__ == '__main__':
    generate(Path(__file__).resolve().parents[1] / 'Sources/ZRemote/Resources')
