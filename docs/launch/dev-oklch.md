# Building an OKLCH palette generator that survives gamut limits and exports to Aseprite

A row of attractive swatches is not yet a useful pixel-art palette.

A working palette needs a readable value structure, controlled hue relationships, predictable ramps, colors that actually fit inside sRGB, and an export format the artist can use without rebuilding everything by hand.

I built [OKLCH Pixel Palette](https://oklchpalette.ru) around that workflow. It is free, open source, requires no account, and runs entirely in the browser.

Source: [github.com/vansGAMee/OKLCH-PIXEL-PALETTE](https://github.com/vansGAMee/OKLCH-PIXEL-PALETTE)

## Why OKLCH instead of HSL

In HSL, two colors with the same numerical lightness can look very different in brightness. That is inconvenient in UI work and especially obvious in small sprites, where one bad value step can flatten the whole form.

OKLCH separates perceptual lightness (`L`), chroma (`C`) and hue (`H`). It does not make color decisions automatic, but it gives the generator a more useful coordinate system:

- lightness steps can be planned as a visible value ladder;
- chroma can be reduced without unintentionally steering the hue;
- harmony rules can operate on hue while the value structure remains inspectable.

The tool generates between 2 and 9 colors from a base color and supports six harmony modes. The important part is not the number of modes. It is that every result remains editable and visible as a lightness progression rather than arriving as a sealed random answer.

## Gamut mapping is product behavior, not cleanup

Browsers can describe OKLCH colors outside the sRGB gamut. Many pixel-art pipelines cannot store or display those colors consistently.

Simply clipping red, green and blue channels produces unpleasant shifts near the boundary. The generator instead reduces chroma until the color fits the target gamut while trying to preserve the intended lightness and hue. It then checks the converted result rather than assuming the math behaved.

Near-black and near-white seeds are good tests because they expose fragile conversions quickly. A palette tool should not turn `#010101` into a colorful surprise or create several visually identical highlight steps. Those edge cases influenced the lightness limits, chroma search and duplicate handling.

## Swatches are not enough

Palette quality depends on use. A ramp that looks elegant in a horizontal strip can fail as soon as it must describe a one-pixel edge.

The site therefore shows live pixel previews—a potion, gem, shield and character—next to the palette. They are intentionally small and familiar. Their job is to reveal value collisions, weak outlines and over-bright accents before export.

The same thinking shaped the editor:

- a visible lightness ladder instead of hidden coefficients;
- Delta E checks for colors that are technically different but perceptually too close;
- an sRGB gamut guard;
- direct editing after generation;
- no account wall between experiment and export.

## Export should end the task

Copying HEX values one at a time is not an export workflow. OKLCH Pixel Palette can produce:

- JASC PAL for Aseprite;
- GIMP GPL;
- HEX and JSON;
- a PNG palette strip.

That makes the generated palette a usable asset rather than a screenshot of an idea.

I previously experimented with accounts and cloud saving. I removed both. Generation, editing, import and export now stay in the browser. The product is simpler, there is no personal palette database to maintain, and opening the site is enough to start work.

## A practical way to test it

Try [the pixel-art palette generator](https://oklchpalette.ru/tools/pixel-art-palette-generator) with three deliberately difficult seeds:

1. a nearly black neutral;
2. a very bright saturated blue;
3. a warm low-chroma midtone.

Change the palette size, compare harmony modes, watch the sprite previews, then export the result as JASC PAL and open it in Aseprite.

If the ramp needs manual correction, I want to know where and why. A useful palette tool should make the correction obvious instead of hiding behind the word “smart.”

Try it: [oklchpalette.ru](https://oklchpalette.ru)

Repository: [github.com/vansGAMee/OKLCH-PIXEL-PALETTE](https://github.com/vansGAMee/OKLCH-PIXEL-PALETTE)

Suggested tags: `webdev`, `css`, `opensource`, `gamedev`
