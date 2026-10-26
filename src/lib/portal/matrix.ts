// "Digital rain" behind the portal pages, tinted with the current role colour.
// One canvas per page, created on first use. It pauses while the tab is hidden and
// draws a single still frame for visitors who prefer reduced motion.

const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789特異点ΣΛΩ<>/=+*';
const FONT_SIZE = 16;
const FRAME_MS = 50; // about 20 frames a second is plenty for falling text

type RGB = [number, number, number];

let canvas: HTMLCanvasElement | null = null;
let current: RGB = [32, 224, 160];
let target: RGB = [32, 224, 160];

function hexToRgb(hex: string): RGB {
	const n = parseInt(hex.replace('#', ''), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Fades the rain toward a new colour over about a second. */
export function setMatrixColor(hex: string) {
	target = hexToRgb(hex);
	if (!canvas) startMatrix(hex);
}

/** Adds the rain to the page (once) in the given colour. */
export function startMatrix(hex = '#20e0a0') {
	target = hexToRgb(hex);
	if (canvas || typeof document === 'undefined') return;
	current = [...target];

	canvas = document.createElement('canvas');
	canvas.className = 'matrix-rain';
	canvas.setAttribute('aria-hidden', 'true');
	document.body.prepend(canvas);
	const ctx = canvas.getContext('2d')!;
	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

	let drops: number[] = [];
	let width = 0;
	let height = 0;

	function resize() {
		const ratio = Math.min(devicePixelRatio || 1, 2);
		width = innerWidth;
		height = innerHeight;
		canvas!.width = width * ratio;
		canvas!.height = height * ratio;
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.font = `${FONT_SIZE}px monospace`;
		const columns = Math.ceil(width / FONT_SIZE);
		// Start each column at a random height so the screen isn't empty on load.
		drops = Array.from({ length: columns }, (_, i) => drops[i] ?? Math.floor((Math.random() * height) / FONT_SIZE));
		if (reducedMotion.matches) drawStill();
	}

	function frame() {
		// Ease the colour toward the target (smooth role changes).
		current = current.map((c, i) => c + (target[i] - c) * 0.08) as RGB;
		const [r, g, b] = current.map(Math.round);

		// Fade the previous frame so falling glyphs leave a trail.
		ctx.globalCompositeOperation = 'destination-out';
		ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
		ctx.fillRect(0, 0, width, height);
		ctx.globalCompositeOperation = 'source-over';

		for (let i = 0; i < drops.length; i++) {
			const y = drops[i] * FONT_SIZE;
			const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
			// The leading glyph is brighter, like the films.
			ctx.fillStyle = Math.random() < 0.08 ? `rgb(${Math.min(255, r + 120)}, ${Math.min(255, g + 120)}, ${Math.min(255, b + 120)})` : `rgb(${r}, ${g}, ${b})`;
			ctx.fillText(glyph, i * FONT_SIZE, y);
			drops[i] = y > height && Math.random() > 0.975 ? 0 : drops[i] + 1;
		}
	}

	function drawStill() {
		ctx.clearRect(0, 0, width, height);
		for (let n = 0; n < 40; n++) frame();
	}

	let last = 0;
	let raf = 0;
	function loop(time: number) {
		raf = requestAnimationFrame(loop);
		if (time - last < FRAME_MS) return;
		last = time;
		frame();
	}

	function play() {
		cancelAnimationFrame(raf);
		if (reducedMotion.matches || document.hidden) {
			// Still frame, recoloured occasionally so role changes still show.
			current = [...target];
			drawStill();
			return;
		}
		raf = requestAnimationFrame(loop);
	}

	addEventListener('resize', resize);
	document.addEventListener('visibilitychange', play);
	reducedMotion.addEventListener('change', play);
	resize();
	play();

	// With reduced motion there's no loop, so redraw when the colour changes.
	setInterval(() => {
		if (reducedMotion.matches && target.some((c, i) => Math.abs(c - current[i]) > 1)) drawStill();
	}, 500);
}
