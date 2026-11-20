#!/usr/bin/env python3
"""Audit a candidate palette for contrast floors and basic harmony relations.

No dependencies, no network. Usage:
  python3 audit_harmony.py '#F2EFE6' '#1C1B19' --accent '#B5482F' --area 0.04
"""
import argparse
import colorsys


def parse_hex(value):
    value = value.strip().lstrip('#')
    if len(value) == 3:
        value = ''.join(ch * 2 for ch in value)
    if len(value) != 6:
        raise ValueError(f'Not a hex color: {value}')
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))


def rel_luminance(rgb):
    def channel(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg, bg):
    a, b = rel_luminance(fg), rel_luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def hue_degrees(rgb):
    h, _, _ = colorsys.rgb_to_hls(*rgb)
    return h * 360


def hue_distance(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def scheme(base_h, other_h):
    d = hue_distance(base_h, other_h)
    if d < 15:
        return 'monochromatic/near-neutral'
    if d <= 60:
        return 'analogous'
    if 150 <= d <= 210:
        return 'complementary'
    if 90 <= d <= 150 or 210 <= d <= 270:
        return 'split-complementary'
    return 'triadic/other'


def main():
    p = argparse.ArgumentParser(description='Contrast + harmony audit for a palette')
    p.add_argument('paper', help='background / skeleton color hex')
    p.add_argument('ink', help='foreground / structure color hex')
    p.add_argument('--accent', help='accent color hex')
    p.add_argument('--area', type=float, default=0.05, help='accent area budget (0-1)')
    args = p.parse_args()

    paper, ink = parse_hex(args.paper), parse_hex(args.ink)
    ratio = contrast(ink, paper)
    print(f'ink/paper contrast = {ratio:.2f}:1  (body >=4.5, large >=3.0)')
    print('PASS body' if ratio >= 4.5 else 'FAIL body' if ratio < 3 else 'large-text-only')

    if args.accent:
        accent = parse_hex(args.accent)
        for label, bg in (('accent on paper', paper), ('accent on ink', ink)):
            r = contrast(accent, bg)
            print(f'{label} = {r:.2f}:1')
        print(f'accent hue relation = {scheme(hue_degrees(paper), hue_degrees(accent))}')
        print(f'accent area budget = {args.area:.1%} (professional tool target <5%)')


if __name__ == '__main__':
    main()
