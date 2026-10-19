// "Thiết kế tự do": Claude art-directs and codes each email like a studio designer (free HTML/CSS: real type scale,
// gradients, overlapping layers, SVG art, icons, motion), Phloem converts the layout into editable layers, and a
// creative-director pass looks at the RENDER (what subscribers will get) and sends back a better version.
// Three directions are planned together (so they really differ), then drawn in parallel, streaming live.
import type { Brand, Doc, EmailFields, Project, Vibe } from '../model/types';
import { BRAND_PRESETS, FONTS, VIBES } from '../model/types';
import { renderToCanvas } from '../render/renderer';
import { assets } from '../storage/assets';
import { ensureFonts } from '../render/fonts';
import { askClaude, extractJson, streamClaude, type AiImage } from './client';
import { GOAL_DESC, thumbOf, type GenInput } from './generate';
import { siteSummary } from './site';
import { extractHtml, htmlToDoc, tokenize } from './htmlToDoc';
import { loadFluent3d } from '../design/library';
import { houseBlock, houseStyleOf, type HouseStyle } from './clientStyle';

export interface Palette { bg: string; surface: string; ink: string; muted: string; primary: string; accent: string; onPrimary: string; line: string }
export interface Direction {
  name: string; why: string; concept: string; aesthetic: string; /** the hero recipe + the wow moment */ signature?: string;
  palette: Palette; headingFont: string; bodyFont: string; vibe: Vibe;
  layout: string[]; motifs: string; images: { id: string; use: string }[]; fields: EmailFields;
}
export type DesignStage = 'queued' | 'drawing' | 'converting' | 'reviewing' | 'ready' | 'error';
export interface DesignVariant { dir: Direction; html: string; stage: DesignStage; doc?: Doc; mobile?: Doc | null; brand?: Brand; thumb?: string; error?: string; warnings?: string[]; reviewed?: boolean }

// ---------------------------------------------------------------------------------------------------------------
// The design brief Claude works from: craft (what good looks like) + the technical contract (what converts).

export const DESIGN_CRAFT = `You are a world-class art director and front-end designer. You design marketing emails that look like they came from a top studio (the craft of Apple, Aesop, Nike, Glossier, Stripe, the best Awwwards work) — never like a template.

DESIGN THINKING (decide before you code)
- Purpose & audience: what the reader must feel and do in the first 3 seconds.
- Execute the given art direction with precision. Intentionality beats intensity: refined minimalism and maximal energy both work when every detail serves one concept.
- One unforgettable idea per email: an oversized number, a cut-out product breaking out of its frame, a typographic poster hero, a sticker collage, a bold colour field, an editorial crop with an overlapping caption card, a ticket-shaped offer…

TYPOGRAPHY
- Distinctive display face + refined body face (only from the allowed list). Never more than two families.
- Dramatic scale contrast: display 52–96px, leading 0.9–1.05, slight negative tracking (-0.01 to -0.03em); body 15–18px / 1.5–1.65; eyebrows/labels 11–13px uppercase, tracking 0.14–0.28em.
- Mix weights on purpose; one highlighted word may change colour, weight or style. Hierarchy readable at a glance.
- Capitalisation: every headline, sentence, card title and button starts with a capital letter (sentence case or Title Case). Never all-lowercase headlines as a style and never text-transform: lowercase. Only a brand name keeps its own spelling.

COLOUR
- A dominant colour with sharp accents beats timid, evenly spread palettes. Build from the direction's palette; derive tints and shades.
- Text contrast AA (4.5:1 body, 3:1 large). Use dark sections for drama and light ones to breathe — deliberately.

COMPOSITION
- Unexpected but controlled: asymmetry, overlap, grid-breaking elements, diagonal energy, cards layered over photos, full-bleed imagery, generous negative space OR deliberate density.
- Vary section rhythm (full-bleed → contained card → split → typographic statement → grid). One idea per section. Clear grid: 40px side margins at 600px, 8px spacing scale, 56–88px vertical padding on major sections.

DETAILS & DEPTH
- Gradient meshes (layered radial-gradients), soft glows (blurred circles), subtle textures (dot grids), decorative SVG shapes (blobs, arcs, stars, squiggles, waves) used sparingly and on-concept, rotated stickers/badges, layered soft shadows, hairline rules, numbered markers, icon bullets, ticket/coupon shapes, framed photos.
- Photos are heroes: crop boldly with object-fit/object-position; never shrink them into timid thumbnails.
- Polish components: buttons with real presence (min 48px tall, generous padding, considered radius/shadow), badges, cards, a designed footer.

FIGMA-LEVEL POLISH (what separates a hand-made design from a template)
- Define the system first in CSS: one spacing scale (8/12/16/24/32/48/64/96), one type scale, 2–3 radii, 1–2 shadow styles; every value comes from it.
- Optical details: headline tracking tight, line-height tight on display and generous on body; balanced line breaks (<br> where a phrase should hold together); no orphans; numbers set big and tabular; consistent icon size and stroke.
- Depth with restraint: real 3D objects or photos as heroes, soft layered shadows (0 24px 48px -12px rgba(…)), glass cards (backdrop-filter blur) over imagery, subtle textures; never flat grey boxes.
- Every section has a reason to look different (background, scale, alignment), yet all share the same system so the email feels like one piece.
- Final check before you answer: alignment to the grid, consistent gutters, contrast, nothing touching an edge accidentally, CTA obvious within the first 600px.

THE WOW BAR (non-negotiable)
- The first screen (top ~700px) is a finished poster: on its own it would earn a save on Dribbble/Behance. Spend half your effort here.
- Hero headline 72–140px (display face), leading 0.82–0.95, tracking -0.02 to -0.045em, 2–3 short lines; scale contrast with the body ≥ 5:1.
- Layering: the hero has at least 3 depth planes (background field/texture → main object/photo → type or card → small badge/sticker), with real overlap between them (an object crossing the headline, a card overlapping a photo edge, a badge sitting on a corner).
- Colour with conviction: a full-bleed colour field, a dark spotlight stage, or a full-bleed photo. A white or pale hero with a small centred headline is never acceptable (except a deliberately "luxury minimal" direction — then the type must be huge and the space dramatic).
- Every later section earns its place with at least one of: overlap, an oversized element (number, word, object), a colour-field switch, texture, a glass card, a rotated badge. No two consecutive sections share the same layout.

SIGNATURE HERO RECIPES (proven in Phloem; adapt one, combine two, never copy blindly)
1. Poster type: section background = primary (full bleed) + <img data-gfx="grain"> absolutely covering it at opacity .18; headline 120px+ in onPrimary, one word as outline (-webkit-text-stroke:2px; color:transparent) or in accent; the product photo/3D object position:absolute with z-index above the headline so it crosses the letters; a 112px circular badge (accent fill, rotate(-12deg), 2-line claim 14px bold uppercase) on the object's shoulder.
2. Product on stage: background radial-gradient(ellipse 70% 55% at 50% 38%, light tint 0%, mid 45%, near-black 100%); a podium = two stacked ellipses (top: light gradient, bottom: darker band) with a blurred dark ellipse shadow under it; product 300–380px tall standing on it; headline huge ABOVE with the product overlapping its bottom 20%; 2–3 tiny spec labels with 1px leader lines pointing at the product.
3. Magazine cover: full-bleed photo 600×720 (object-fit:cover, choose object-position); masthead = brand or campaign word 110–150px across the top, tight tracking; 3 cover lines (12–14px uppercase, a big number each) on the left; issue tag top-right; a frosted-glass CTA pill bottom-left (backdrop-filter blur 20px, rgba white .18, 1px rgba white .4 border).
4. Colour blocks + marquee: two stacked colour fields, a 760px-wide band rotated -5deg crossing the seam carrying repeated caps text ("NEW DROP ✦ NEW DROP ✦ …", 22px bold) ; photo in an arch frame (border-radius 300px 300px 24px 24px) overlapping both fields; headline left-aligned 96px.
5. Giant offer number: "30%" (or the real number) 180–220px in the display face with an outlined duplicate offset 8px behind it (two absolutely positioned layers), a ticket card below with notches (two 28px circles in the background colour at the side edges), a 1px divider (dashed borders render solid) and the code in a mono face, 3D sticker (gift / money / fire) tilted at a corner.
6. Glass over mesh: background = 3–4 large blurred circles (filter:blur(60px), brand colours, overlapping) or <img data-gfx="aurora|blur">; a frosted-glass card holds headline + CTA; a 3D object 180–220px breaks out of the card's top edge (negative top, z-index above).
7. Collage: 2–3 photos as polaroids (white 10px border, rotate ±3–6deg, soft shadow) overlapping each other, translucent "tape" strips (rotated rgba rects) on corners, a handwritten-style accent word, 1–2 stickers; headline set on a solid colour block that overlaps the collage.
8. Bento: a 2–3 column grid of cards with different spans and fills (one photo tile, one huge-number stat tile, one 3D-object tile, one quote/claim tile), radius 20–28px, 12px gaps, each tile a different but harmonious colour.

TREND RADAR 2026 (what reads as fresh right now; pick the 1–2 moves that suit the brand, never stack them all)
- Editorial serif revival: a high-contrast display serif with italic accents + a clean grotesk; magazine columns, issue numbers, pull quotes, drop caps.
- Bento: modular tiles of different spans and fills (stat, photo, product, quote), radius 16–28px, 8–12px gaps.
- Tactile 3D: soft rendered objects and glossy shapes casting real shadows onto saturated colour fields; squishy pill buttons.
- Grain + aurora: blurred colour meshes under film grain, warm↔cool duotones (never the default purple SaaS gradient).
- Big type crops: one giant word or number cropped by the section edge, outline type, stacked headlines in two weights.
- Scrapbook: tape, polaroids, stickers, hand-drawn circles and arrows annotating the product, torn-paper bands.
- Product cut-outs on colour: isolated products floating over a strong field with long soft shadows and spec call-outs on leader lines.
- Neo-brutalist poster: thick rules, hard offset shadows (6px 6px 0 #000), boxed labels, mono type, bright primaries.
- Quiet luxury: lots of air, tiny tracked caps, hairlines, one striking photo, muted earth palette, huge serif.
- Soft glass: frosted cards over photos or meshes, pill buttons, 1px inner light borders.
- Retro revival (playful brands only): 70s warm palette + rounded serifs, Y2K chrome + star sparkles, 90s web stickers.
- Ticket & receipt: coupon notches, rows of dots as perforation, barcode from thin rects, receipt type for the offer.
- Dark-mode native: rich near-black stage with neon or pastel accents that survives mail-client colour inversion.
- Social proof as chat: reviews as message bubbles / UGC cards with stars and @handles.
- Interactive look: a progress bar to free shipping, countdown tiles, scratch-card "reveal", toggles as decoration.

AVOID (generic AI look)
- Purple-on-white gradients by default; everything centred in identical rounded cards; emoji bullet lists; grey boxes; 24px headlines; Inter/Roboto everywhere; cookie-cutter SaaS sections; decoration unrelated to the brand; "Welcome to our newsletter" copy.

COPY
- Specific, benefit-first, short. Headline ≤ 8 words. One primary CTA (1–3 words), repeated near the end. Use real data from the brief (prices, codes, dates, products, links); never invent numbers or testimonials that were not given (use policy facts instead).`;

export const DESIGN_TECH = `TECHNICAL CONTRACT (Phloem converts the browser layout into editable layers — follow exactly)
OUTPUT: one complete HTML document inside a single \`\`\`html fenced block, nothing else. Put all CSS in one <style> in <head>.
CANVAS: <body> holds exactly one <div id="email" data-email> with width:600px and the email background colour; inside it, 6–10 <section data-name="Short name"> stacked vertically. Sections own their padding. Absolutely positioned decoration must sit inside a position:relative section (use overflow:hidden on that section when decoration bleeds).
CONVERTS (use freely):
- Layout: flex, grid, absolute positioning, negative margins, overlap, z-index.
- Boxes: background-color; background-image with linear-gradient()/radial-gradient() (several layers OK: mesh glows); borders (all or single sides); border-radius (per corner OK); outer box-shadow; opacity; transform rotate()/translate()/scale(); filter: blur() for glows; backdrop-filter: blur(16–28px) with a translucent rgba() fill and a 1px light border for frosted-glass cards over photos or colour.
- Text: font-family (ONLY allowed fonts), font-size, font-weight, font-style, line-height, letter-spacing, text-transform, text-align, color, text-decoration, text-shadow (glow or hard long shadow), -webkit-text-stroke with transparent fill (outline display type). <br> for intentional breaks. <span> may change colour/weight/font inside a heading.
- Photos: ONLY <img data-img="IMAGE_ID" alt="…"> with ids from the image list; size with CSS width/height; object-fit:cover|contain; object-position to choose the focus.
- Icons & stickers: <img data-icon="set:name" alt="" style="width:28px;height:28px;color:#hex"> (always width+height; colour via CSS color for monochrome sets). Sets: ph (Phosphor — e.g. ph:arrow-right-bold, ph:star-fill, ph:truck-duotone, ph:lightning-fill, ph:check-circle-fill, ph:gift-duotone, ph:clock-countdown-fill), lucide, tabler, mdi, simple-icons (brand logos: simple-icons:instagram, simple-icons:facebook, simple-icons:tiktok, simple-icons:youtube, simple-icons:x, simple-icons:linkedin), fluent-emoji (colourful 3D-style stickers: fluent-emoji:fire, fluent-emoji:sparkles, fluent-emoji:party-popper, fluent-emoji:wrapped-gift, fluent-emoji:rocket, fluent-emoji:red-heart, fluent-emoji:star, fluent-emoji:high-voltage, fluent-emoji:shopping-bags, fluent-emoji:crown, fluent-emoji:gem-stone, fluent-emoji:hundred-points, fluent-emoji:alarm-clock, fluent-emoji:delivery-truck, fluent-emoji:hot-beverage, fluent-emoji:cherry-blossom). Only real icon names.
- 3D objects (studio-quality renders, transparent PNG — the fastest way to make an email look designed and premium): <img data-sticker="name" alt="" style="width:120px;height:120px"> (square, 64–220px; float them over cards, tilt with rotate(), overlap edges, add a soft shadow ellipse or glow under them; 1–4 per email). Names: rocket, wrapped-gift, fire, party-popper, confetti-ball, sparkles, glowing-star, star, crown, gem-stone, money-bag, money-with-wings, dollar-banknote, coin, shopping-bags, shopping-cart, package, delivery-truck, credit-card, label, megaphone, bell, alarm-clock, hourglass-not-done, stopwatch, calendar, spiral-calendar, trophy, 1st-place-medal, sports-medal, red-heart, sparkling-heart, heart-with-ribbon, high-voltage, collision, hundred-points, thumbs-up, clapping-hands, waving-hand, raising-hands, flexed-biceps, smiling-face-with-heart-eyes, star-struck, partying-face, smiling-face-with-sunglasses, face-blowing-a-kiss, eyes, light-bulb, gear, wrench, hammer-and-wrench, magnifying-glass-tilted-left, laptop, desktop-computer, mobile-phone, headphone, camera, camera-with-flash, video-game, joystick, game-die, puzzle-piece, teddy-bear, balloon, birthday-cake, shortcake, cupcake, doughnut, cookie, ice-cream, soft-ice-cream, hot-beverage, teacup-without-handle, bubble-tea, tropical-drink, cocktail-glass, beer-mug, wine-glass, pizza, hamburger, sushi, bento-box, steaming-bowl, strawberry, lemon, peach, cherries, watermelon, avocado, herb, seedling, potted-plant, four-leaf-clover, cherry-blossom, sunflower, tulip, bouquet, rose, sun, sun-behind-cloud, rainbow, cloud, snowflake, droplet, water-wave, globe-showing-asia-australia, world-map, compass, airplane, house, house-with-garden, office-building, cityscape, beach-with-umbrella, camping, national-park, mountain, books, open-book, graduation-cap, pencil, memo, envelope, love-letter, incoming-envelope, open-mailbox-with-raised-flag, key, shield, chart-increasing, bar-chart, clipboard, briefcase, handshake, robot, alien-monster, ghost, unicorn, butterfly, lady-beetle, dog-face, cat-face, panda, fox, rabbit-face, chicken, t-shirt, dress, jeans, running-shoe, high-heeled-shoe, handbag, ring, lipstick, lotion-bottle, sponge, soap, crystal-ball, magic-wand, christmas-tree, jack-o-lantern, red-envelope, moon-cake, firecracker, fireworks, sparkler, red-paper-lantern, dragon.
- Generated graphics (drawn in the brand palette, crisp at any size): <img data-gfx="ID" data-colors="#bg,#c1,#c2,#c3,#ink" data-seed="7" alt="" style="width:600px;height:260px">. Backgrounds: waves, peaks, blobs, blur (soft gradient mesh), aurora, lowpoly, sunburst, steps, topo, grain. Patterns: dots, grid, stripes, checker, zigzag, plus, rings, halftone, memphis, confetti, sparkles. Glossy 3D shapes: sphere, capsule, cube, torus, cylinder, pyramid. Decoration: frame-scallop, arch-frame, wavy-frame, corners, scribble-circle, brush, ticket. Use them as section backgrounds (absolutely positioned behind content), texture bands, frames around photos, or floating accents; change data-seed for a different variant.
- Illustration & decoration: inline <svg viewBox="…" width="…" height="…"> with paths/shapes (blobs, waves, arcs, stars, squiggles, dot grids, arrows, abstract illustrations), colours as fill/stroke attributes or CSS. No <text> inside SVG.
- Links: every clickable element inside <a href="real URL">. Wrap each product/offer card in ONE <a> so the whole card is clickable; at most 6 distinct destinations per email. Unsubscribe <a href="*|UNSUB|*">, preferences <a href="*|UPDATE_PROFILE|*">.
- Footer: brand line, website or address, social icons (simple-icons inside links), and the exact words "Huỷ đăng ký" (Vietnamese copy) or "Unsubscribe" (English) linked to *|UNSUB|*.
- Motion (exported as GIF, every animated pixel adds weight): data-anim on 2–5 SMALL elements only (badge, sticker, 3D object, headline, CTA; each under ~600×300px; never a photo, a background or a whole section). Entrances "fade|up|down|left|right|pop|wipe|type" with data-delay="0.15" (seconds), only in the first section or two. Loops "pulse|float|spin|shake|blink" on at most 2 small stickers/badges (every animated area becomes a GIF, keep them few and small).
NEVER (lost in conversion): ::before/::after content, CSS background url(), background-clip:text or gradient-filled text, mask, clip-path, mix-blend-mode, backdrop-filter other than blur(), CSS animations/transitions, <video>, <canvas>, <script>, iframes, list bullets (use icon/shape markers), fonts not in the list, <link> tags, external image URLs, text baked into SVG.
MOBILE: add @media (max-width:480px) rules: #email{width:100%!important}; stack columns; display type ≈0.6×; side padding 20–24px; images full width. Phloem renders the same HTML at 375px for the mobile version, so nothing may overflow 375px there.
SIZE: total height 1600–2600px at 600px wide. Body text ≥ 15px, labels ≥ 12px, footer ≥ 12px, buttons ≥ 48px tall. Text on photos needs a scrim or a solid card behind it.`;

/** The hero recipe list alone, for the planner. */
const HERO_RECIPES = DESIGN_CRAFT.slice(DESIGN_CRAFT.indexOf('SIGNATURE HERO RECIPES'), DESIGN_CRAFT.indexOf('TREND RADAR 2026')).trim();
/** The trend radar alone, for the planner. */
const TRENDS = DESIGN_CRAFT.slice(DESIGN_CRAFT.indexOf('TREND RADAR 2026'), DESIGN_CRAFT.indexOf('AVOID (generic AI look)')).trim();

const CRITIC = `You are the creative director reviewing a designer's email before it ships. You receive the art direction, the HTML, and screenshots of how it RENDERS in Phloem (exactly what subscribers will see). Your standard is the best studio work on Behance, not "good enough".
1. Silently score the hero and every section 1–10 on impact, typography, composition/layering, colour and polish. Anything below 8 is REBUILT, not nudged: bigger headline, a real overlap, a colour-field switch, a 3D object or photo used boldly, a stronger recipe from the list. A timid hero (small headline, pale flat background, nothing overlapping) is always below 8.
2. Fix everything wrong in the render: overlapping or clipped text, elements outside the 600px canvas, misalignment, cramped or uneven spacing, weak contrast, awkward empty areas, badly cropped photos, decoration covering content, lowercase sentence starts, anything that did not convert (follow the technical contract), sections that feel unfinished.
3. Keep the concept, palette, fonts, copy facts, links and image ids.
4. If a CLIENT HOUSE STYLE is given, anything off-brand is a defect: wrong colour roles, a foreign type feel, copy against the voice, a "never" from the brand book.
Return the COMPLETE revised HTML document in one \`\`\`html block. No commentary.`;

// ---------------------------------------------------------------------------------------------------------------

interface Ctx { lang: 'vi' | 'en'; brief: string; imageLines: string[]; thumbs: Map<string, AiImage>; validIds: Set<string>; fonts: string; presets: string; house: HouseStyle | null }

/** Trends the user can ask for in Dựng bằng AI ('' = the AI picks what suits the brand). */
export const TREND_OPTIONS: { id: string; label: string; brief: string }[] = [
  { id: '', label: 'AI chọn hợp thương hiệu', brief: '' },
  { id: 'editorial', label: 'Tạp chí (editorial serif)', brief: 'Editorial serif revival: magazine layout, high-contrast display serif with italic accents, issue numbers, pull quotes.' },
  { id: 'bento', label: 'Bento', brief: 'Bento: modular tiles of different spans and fills (stat, photo, product, quote) with generous radii.' },
  { id: 'tactile3d', label: '3D mềm (tactile)', brief: 'Tactile 3D: soft 3D objects and glossy shapes casting shadows onto saturated colour fields, squishy pill buttons.' },
  { id: 'aurora', label: 'Gradient + grain', brief: 'Grain + aurora: blurred colour meshes under film grain, warm↔cool duotones, frosted glass over the mesh.' },
  { id: 'bigtype', label: 'Chữ khổng lồ', brief: 'Big type crops: giant words/numbers cropped by the edges, outline type, stacked headlines.' },
  { id: 'scrapbook', label: 'Scrapbook / collage', brief: 'Scrapbook: polaroids, tape, stickers, hand-drawn circles and arrows, torn-paper bands.' },
  { id: 'cutout', label: 'Sản phẩm tách nền', brief: 'Product cut-outs floating on strong colour fields with long soft shadows and spec call-outs.' },
  { id: 'brutalist', label: 'Brutalist poster', brief: 'Neo-brutalist poster: thick rules, hard offset shadows, boxed labels, mono type, bright primaries.' },
  { id: 'luxury', label: 'Sang trọng tối giản', brief: 'Quiet luxury: lots of air, tiny tracked caps, hairlines, one striking photo, muted earth palette, huge serif.' },
  { id: 'retro', label: 'Retro 70s / Y2K', brief: 'Retro revival: 70s warm palette and rounded serifs, or Y2K chrome with star sparkles (pick what suits the brand).' },
  { id: 'dark', label: 'Nền tối neon', brief: 'Dark-mode native: rich near-black stage with neon or pastel accents.' },
];

function langOf(inp: GenInput): 'vi' | 'en' { return inp.language && inp.language !== 'auto' ? inp.language : (inp.site?.lang || '').toLowerCase().startsWith('en') ? 'en' : 'vi'; }

async function buildCtx(inp: GenInput): Promise<{ ctx: Ctx; images: AiImage[] }> {
  const lang = langOf(inp);
  const ids = [...new Set([...(inp.logoAssetId ? [inp.logoAssetId] : []), ...(inp.logoLightAssetId ? [inp.logoLightAssetId] : []), ...inp.imageIds])].filter((id) => assets.get(id));
  const thumbs = new Map<string, AiImage>(); const images: AiImage[] = []; const imageLines: string[] = [];
  for (const id of ids) {
    const m = assets.get(id)!;
    const role = id === inp.logoAssetId ? ' · LOGO (dùng ở header/footer trên nền sáng)' : id === inp.logoLightAssetId ? ' · LOGO SÁNG (dùng trên nền tối)' : m.src?.kind === 'web' ? ` · từ trang ${m.src.page || '/'}` : '';
    if (images.length < 24) { const t = await thumbOf(id); if (t) { thumbs.set(id, t); images.push(t); imageLines.push(`- "${id}": ${m.name} · ${m.w}×${m.h}px${role} (ảnh #${images.length} đính kèm)`); continue; } }
    imageLines.push(`- "${id}": ${m.name} · ${m.w}×${m.h}px${role}`);
  }
  const fonts = FONTS.filter((f) => f.google && (lang !== 'vi' || f.vi)).map((f) => `${f.family} (${f.cat})`).join(', ');
  const presets = BRAND_PRESETS.map((p) => `${p.name} ${p.brand.primary}/${p.brand.accent} on ${p.brand.bg}`).join('; ');
  const trend = TREND_OPTIONS.find((t) => t.id && t.id === inp.trend);
  const brief = [
    houseBlock(inp.house),
    trend ? `TREND THE USER WANTS: ${trend.brief} All three directions build on it in different ways (vary concept and composition)${inp.house ? ', inside the client house style' : ''}.` : '',
    inp.site ? `WEBSITE PROFILE (read by Phloem):\n${siteSummary(inp.site, inp.webBrand || {})}` : '',
    inp.webBrand ? `Brand colours from the website: primary ${inp.webBrand.primary}, accent ${inp.webBrand.accent}, ink ${inp.webBrand.ink}, background ${inp.webBrand.bg}.` : '',
    inp.products && inp.products.length ? `PRODUCTS (use exactly these names/prices/links/images):\n${inp.products.map((p) => `- ${p.name}${p.price ? ` · ${p.price}` : ''}${p.compareAt ? ` (was ${p.compareAt})` : ''} · ${p.url || ''}${p.assetId ? ` · image "${p.assetId}"` : ''}`).join('\n')}` : '',
    `Email type: ${GOAL_DESC[inp.goal] || inp.goal}`,
    `Brand: ${inp.brandName || inp.webBrand?.name || 'BRAND'}`,
    `Tone: ${inp.tone}`,
    inp.palette !== 'auto' && inp.palette !== 'Web' ? `The user picked the palette "${inp.palette}" (${JSON.stringify(BRAND_PRESETS.find((p) => p.name === inp.palette)?.brand || {})}): all three directions use it.` : inp.palette === 'Web' ? 'The user wants the website colours: all three directions build on them.' : '',
    `Brief: ${inp.brief || '(none)'}`,
    `Raw content (headlines, products, prices, links, dates, codes):\n${inp.content || '(none — write sensible copy for this email type, no invented numbers)'}`,
    `COPY LANGUAGE: ${lang === 'en' ? 'English (natural, concise marketing English)' : 'Vietnamese (tiếng Việt tự nhiên, đúng chính tả, có dấu)'}`,
  ].filter(Boolean).join('\n\n');
  return { ctx: { lang, brief, imageLines, thumbs, validIds: new Set(ids), fonts, presets, house: inp.house || null }, images };
}

const PLAN = `You are the creative director of a top design studio. Plan THREE email designs for the brief: three genuinely different art directions (different concept, composition, mood and type — not colour swaps), each one right for this brand and goal. If a website profile is given, all three must feel like that brand's own team made them (its colours, its voice); still vary concept and composition.
The designer has: the user's photos, a library of studio-quality 3D objects (gifts, rockets, food, devices, hearts, trophies…), procedural backgrounds/patterns/glossy 3D shapes in any palette, thousands of icons and stickers, frosted-glass cards, and ~100 Google fonts with Vietnamese. Plan directions that use these deliberately (e.g. a hero built around one big 3D object, a glass card over a photo, a patterned band).
If a CLIENT HOUSE STYLE is given, it outranks everything else: all three directions use the client's palette roles, type, voice, logo/footer treatment and photo style (screenshots of its recent emails may be attached as past-email-N: keep the family resemblance, never repeat their hero idea); the directions differ in concept and composition, not in brand.
Each direction must feel current: name in "signature" which 1–2 moves from the TREND RADAR it uses (or the trend the user asked for).
Each direction must clear the WOW bar: a first screen that is a finished poster (full-bleed colour field, spotlight stage or full-bleed photo; 3+ overlapping depth planes; a 72–140px headline). The three directions use three DIFFERENT hero recipes.
Aesthetic territories to draw from (pick what fits, combine, or invent): editorial magazine, Swiss grid, neo-brutalist poster, luxury minimal, soft pastel / organic, playful toy-like stickers, retro-futuristic chrome, Y2K, art deco geometric, Japanese minimal, bold sports campaign, product-on-stage studio lighting, collage / scrapbook, monochrome high-contrast, warm craft / handmade.
Return ONLY JSON:
{"directions":[{"name":"short name in the copy language","why":"one sentence: why this direction for this goal","aesthetic":"2–5 words","signature":"the hero recipe it builds on (number + name from the recipe list, or a new idea described as precisely) and the one wow moment a subscriber will remember","concept":"3–5 sentences of art direction: the unforgettable idea, hero composition (planes, what overlaps what, scale of the headline), mood, type treatment, decorative motifs, how photos/3D objects are used","palette":{"bg":"#hex email background","surface":"#hex cards/sections","ink":"#hex main text","muted":"#hex secondary text","primary":"#hex brand/CTA colour","accent":"#hex second colour","onPrimary":"#hex text on primary","line":"#hex hairlines"},"headingFont":"from list","bodyFont":"from list","vibe":"clean|playful|bold|luxury|editorial","layout":["Section 1 — what it is and how it looks", "… 6–9 entries"],"motifs":"decoration + icons/stickers + motion plan","images":[{"id":"image id","use":"where/how"}],"fields":{"campaignName":"short","subject":"30–55 chars, concrete benefit","preheader":"40–90 chars, continues the subject"}}]}`;

/** Three distinct directions, planned together (so they differ for real). */
export async function planDirections(inp: GenInput, c: Ctx, images: AiImage[], signal?: AbortSignal): Promise<Direction[]> {
  const text = await askClaude({
    system: `${PLAN}\n\n${HERO_RECIPES}\n\n${TRENDS}\n\nAllowed fonts: ${c.fonts}.\nPalette presets you may adapt${c.house ? ' (only when the client palette does not cover a role)' : ''}: ${c.presets}.`,
    turns: [{ role: 'user', text: `${c.brief}\n\nIMAGES (ids; attached in order):\n${c.imageLines.join('\n') || '(none — design with type, colour, shapes and icons)'}${c.house?.images.length ? `\n\nAfter the photos: ${c.house.images.length} screenshot(s) of this client's recent emails (style reference only, not usable images).` : ''}`, images: [...images, ...(c.house?.images || [])] }],
    maxTokens: 12000, effort: 'high',
  });
  if (signal?.aborted) throw new Error('Đã huỷ.');
  const j = extractJson<{ directions?: Direction[] }>(text);
  const dirs = (j.directions || []).filter((d) => d && d.name && d.palette).slice(0, 3);
  if (!dirs.length) throw new Error('AI không lên được hướng thiết kế nào. Thử mô tả rõ hơn.');
  const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : d);
  const okFont = (f: unknown, d: string) => { const hit = FONTS.find((x) => x.family.toLowerCase() === String(f || '').toLowerCase() && (c.lang !== 'vi' || x.vi)); return hit ? hit.family : d; };
  return dirs.map((d) => onBrand({
    ...d,
    palette: { bg: hex(d.palette?.bg, '#FFFFFF'), surface: hex(d.palette?.surface, '#F4F4F2'), ink: hex(d.palette?.ink, '#111111'), muted: hex(d.palette?.muted, '#666666'), primary: hex(d.palette?.primary, '#111111'), accent: hex(d.palette?.accent, '#FF5C39'), onPrimary: hex(d.palette?.onPrimary, '#FFFFFF'), line: hex(d.palette?.line, '#E5E5E5') },
    headingFont: okFont(d.headingFont, 'Be Vietnam Pro'), bodyFont: okFont(d.bodyFont, 'Be Vietnam Pro'),
    vibe: VIBES.some((v) => v.v === d.vibe) ? d.vibe : 'clean',
    layout: Array.isArray(d.layout) ? d.layout.map(String) : [],
    images: Array.isArray(d.images) ? d.images.filter((x) => x && c.validIds.has(String(x.id))).map((x) => ({ id: String(x.id), use: String(x.use || '') })) : [],
    fields: { campaignName: String(d.fields?.campaignName || d.name), subject: String(d.fields?.subject || ''), preheader: String(d.fields?.preheader || '') },
  }, c.house));
}

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 48; };
const lum = (h: string) => { const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** The client's type and main colour are not up for debate: a direction that drifted gets them back. */
export function onBrand(d: Direction, h: HouseStyle | null): Direction {
  if (!h) return d;
  const out = { ...d, palette: { ...d.palette } };
  if (h.fonts.heading) out.headingFont = h.fonts.heading;
  if (h.fonts.body) out.bodyFont = h.fonts.body;
  if (h.primary && ![out.palette.primary, out.palette.accent, out.palette.bg].some((x) => near(x, h.primary!))) { out.palette.primary = h.primary; out.palette.onPrimary = lum(h.primary) > 0.45 ? '#111111' : '#FFFFFF'; }
  return out;
}

function dirText(d: Direction): string {
  return `ART DIRECTION "${d.name}" — ${d.aesthetic}\n${d.signature ? `Signature: ${d.signature}\n` : ''}${d.concept}\nPalette: ${JSON.stringify(d.palette)}\nFonts: heading "${d.headingFont}", body "${d.bodyFont}"\nLayout plan:\n${d.layout.map((l, i) => `${i + 1}. ${l}`).join('\n')}\nMotifs & motion: ${d.motifs}\nImages: ${d.images.map((x) => `"${x.id}" → ${x.use}`).join('; ') || 'as you see fit'}\nSubject: ${d.fields.subject} · Preheader: ${d.fields.preheader}`;
}

function picks(c: Ctx, d: Direction, max = 8): AiImage[] {
  const ids = [...new Set([...d.images.map((x) => x.id), ...[...c.thumbs.keys()]])].slice(0, max);
  return ids.map((id) => c.thumbs.get(id)).filter((x): x is AiImage => !!x);
}

/** The designer writes the HTML, streaming (onHtml gets the partial document for a live preview). */
export async function drawDirection(c: Ctx, d: Direction, onHtml: (html: string) => void, signal?: AbortSignal): Promise<string> {
  const imgs = picks(c, d); const ref = c.house?.images || [];
  const text = await streamClaude({
    system: `${DESIGN_CRAFT}\n\n${DESIGN_TECH}\n\nAllowed fonts (font-family values, exact spelling): ${c.fonts}.`,
    turns: [{ role: 'user', text: `${c.brief}\n\n${dirText(d)}\n\nIMAGE LIST (data-img ids; the attached images are the first ${imgs.length} of the direction's picks, in order):\n${c.imageLines.join('\n') || '(no images: build the visuals with type, colour, SVG shapes, icons and stickers)'}${ref.length ? `\n\nThe last ${ref.length} attachment(s) are screenshots of this client's recent emails: match their family look (type, colour roles, logo/header and footer treatment, buttons), not their layout.` : ''}\n\nDesign and code this email now.`, images: [...imgs, ...ref] }],
    maxTokens: 32000, effort: 'high',
  }, (t) => onHtml(extractHtml(t)), signal);
  const html = extractHtml(text);
  if (!/<(div|section|table)[\s>]/i.test(html)) throw new Error('AI không trả về HTML.');
  return html;
}

/** Screenshots of the converted render, cut into tall-but-legible pieces. */
function shots(doc: Doc, brand: Brand): AiImage[] {
  const c = renderToCanvas(doc, brand, assets, 1);
  const out: AiImage[] = []; const step = 1100;
  for (let y = 0; y < c.height && out.length < 4; y += step) {
    const h = Math.min(step, c.height - y);
    const p = document.createElement('canvas'); p.width = c.width; p.height = h;
    p.getContext('2d')!.drawImage(c, 0, -y);
    out.push({ name: `render-${out.length + 1}.jpg`, mime: 'image/jpeg', base64: p.toDataURL('image/jpeg', 0.84).split(',')[1] });
  }
  return out;
}

/** The creative director looks at the render and returns an improved HTML. */
export async function reviewDirection(c: Ctx, d: Direction, html: string, doc: Doc, brand: Brand, notes: string[], onHtml: (html: string) => void, signal?: AbortSignal): Promise<string> {
  const imgs = shots(doc, brand);
  const text = await streamClaude({
    system: `${CRITIC}\n\n${DESIGN_CRAFT}\n\n${DESIGN_TECH}\n\nAllowed fonts: ${c.fonts}.`,
    turns: [{ role: 'user', text: `${c.brief}\n\n${dirText(d)}\n\nIMAGE LIST:\n${c.imageLines.join('\n') || '(none)'}\n\n${notes.length ? `CONVERTER NOTES:\n- ${notes.join('\n- ')}\n\n` : ''}The attached ${imgs.length} screenshot(s) are the Phloem render, top to bottom (600px wide).\n\nCURRENT HTML:\n\`\`\`html\n${html}\n\`\`\``, images: imgs }],
    maxTokens: 32000, effort: 'high',
  }, (t) => onHtml(extractHtml(t)), signal);
  const out = extractHtml(text);
  return /<(div|section|table)[\s>]/i.test(out) ? out : html;
}

/** Brand record for a direction (so the rest of Phloem — Thương hiệu, auto-fix, new blocks — speaks the same language). */
export function designBrand(d: Direction, base: Brand): Brand {
  const p = d.palette;
  return { ...base, primary: p.primary, accent: p.accent, onPrimary: p.onPrimary, ink: p.ink, muted: p.muted, bg: p.bg, soft: p.surface, line: p.line, fontFamily: d.bodyFont, headingFamily: d.headingFont, vibe: d.vibe, gradient: null };
}

/** HTML → desktop doc (+ mobile at 375 when the CSS is responsive), colours tied to brand tokens. */
export async function convertDesign(html: string, d: Direction, base: Brand, validIds: Set<string>, onStage?: (m: string) => void): Promise<{ doc: Doc; mobile: Doc | null; brand: Brand; warnings: string[] }> {
  ensureFonts([d.headingFont, d.bodyFont]);
  const r = await htmlToDoc(html, { width: 600, validIds, onStage });
  const pal = { primary: d.palette.primary, accent: d.palette.accent, ink: d.palette.ink, muted: d.palette.muted, bg: d.palette.bg, soft: d.palette.surface, line: d.palette.line, onPrimary: d.palette.onPrimary };
  const doc = tokenize(r.doc, pal);
  let mobile: Doc | null = null;
  try {
    const m = await htmlToDoc(html, { width: 375, validIds });
    if (m.overflow <= 6) mobile = tokenize(m.doc, pal);
  } catch { /* desktop only */ }
  const warnings = [...r.warnings];
  if (r.overflow > 6) warnings.push(`Có phần tràn ra ngoài 600px (${r.overflow}px).`);
  return { doc, mobile, brand: designBrand(d, base), warnings };
}

/** Every picture of a converted doc decoded, so thumbnails never catch placeholders (3D objects, icons just added). */
export async function readyDoc(doc: Doc): Promise<void> {
  const ids: string[] = [];
  const walk = (list: Doc['nodes']) => { for (const n of list) { if (n.type === 'image' && n.assetId) ids.push(n.assetId); if (n.type === 'group') walk(n.children); } };
  walk(doc.nodes);
  await Promise.race([assets.ensure([...new Set(ids)]), new Promise((r) => setTimeout(r, 8000))]);
}

export function thumbOfDoc(doc: Doc, brand: Brand, width = 480, ratio = 2.2): string {
  const s = width / doc.width;
  const c = renderToCanvas({ ...doc, height: Math.min(doc.height, doc.width * ratio) }, brand, assets, s);
  return c.toDataURL('image/jpeg', 0.86);
}

/** Whole flow: plan 3 → draw each (live) → convert → creative-director review → convert. Updates arrive per variant. */
export async function designEmail(inp: GenInput, base: Brand, cb: { onPlan: (v: DesignVariant[]) => void; onUpdate: (i: number, patch: Partial<DesignVariant>) => void; onStage: (m: string) => void }, opts: { review: boolean; signal?: AbortSignal }): Promise<void> {
  cb.onStage('Đang xem ảnh và nội dung…');
  await loadFluent3d().catch(() => null);
  const { ctx, images } = await buildCtx(inp);
  cb.onStage('Creative director đang lên 3 hướng thiết kế…');
  const dirs = await planDirections(inp, ctx, images, opts.signal);
  ensureFonts(dirs.flatMap((d) => [d.headingFont, d.bodyFont]));
  cb.onPlan(dirs.map((dir) => ({ dir, html: '', stage: 'queued' })));
  cb.onStage('Đang vẽ 3 phương án cùng lúc…');
  lastCtx = { ctx, base };
  await Promise.all(dirs.map((dir, i) => drawOne(ctx, dir, i, base, cb, opts)));
}

/** The context of the last run, so one failed direction can be drawn again without redoing the others. */
let lastCtx: { ctx: Ctx; base: Brand } | null = null;

/** Draw (again) one direction of the last run: draw, convert, creative-director review. */
export async function redrawDirection(dir: Direction, i: number, cb: { onUpdate: (i: number, patch: Partial<DesignVariant>) => void }, opts: { review: boolean; signal?: AbortSignal }): Promise<void> {
  if (!lastCtx) throw new Error('Phiên vẽ đã hết, bấm Tạo lại.');
  await drawOne(lastCtx.ctx, dir, i, lastCtx.base, cb, opts);
}

async function drawOne(ctx: Ctx, dir: Direction, i: number, base: Brand, cb: { onUpdate: (i: number, patch: Partial<DesignVariant>) => void }, opts: { review: boolean; signal?: AbortSignal }): Promise<void> {
  try {
    cb.onUpdate(i, { stage: 'drawing', error: undefined, html: '' });
    let last = 0;
    let html = await drawDirection(ctx, dir, (h) => { const now = Date.now(); if (now - last > 900) { last = now; cb.onUpdate(i, { html: h }); } }, opts.signal);
    cb.onUpdate(i, { html, stage: 'converting' });
    let conv = await convertDesign(html, dir, base, ctx.validIds);
    await readyDoc(conv.doc);
    cb.onUpdate(i, { doc: conv.doc, mobile: conv.mobile, brand: conv.brand, warnings: conv.warnings, thumb: thumbOfDoc(conv.doc, conv.brand), stage: opts.review ? 'reviewing' : 'ready' });
    if (!opts.review) return;
    try {
      const better = await reviewDirection(ctx, dir, html, conv.doc, conv.brand, conv.warnings, (h) => { const now = Date.now(); if (now - last > 900) { last = now; cb.onUpdate(i, { html: h }); } }, opts.signal);
      if (better !== html) {
        const c2 = await convertDesign(better, dir, base, ctx.validIds);
        await readyDoc(c2.doc);
        html = better; conv = c2;
      }
    } catch (e) { if (opts.signal?.aborted) throw e; /* keep the first version */ }
    cb.onUpdate(i, { html, doc: conv.doc, mobile: conv.mobile, brand: conv.brand, warnings: conv.warnings, thumb: thumbOfDoc(conv.doc, conv.brand), stage: 'ready', reviewed: true });
  } catch (e) {
    cb.onUpdate(i, { stage: 'error', error: opts.signal?.aborted ? 'Đã dừng.' : (e as Error).message });
  }
}

/** "AI tự chỉnh" on an untouched free-form design: the creative director reviews the current render and redraws it. */
export async function reviseDesign(p: Project, onStage: (m: string) => void): Promise<{ html: string; doc: Doc; mobile: Doc | null; brand: Brand; warnings: string[] } | null> {
  const dz = p.design; if (!dz || !dz.dir) return null;
  await loadFluent3d().catch(() => null);
  const d = dz.dir as Direction;
  const ids = [...new Set([...dz.html.matchAll(/data-img="([^"]+)"/g)].map((m) => m[1]).filter((id) => assets.get(id)))];
  const language: 'vi' | 'en' = /[ăâđêôơư]/i.test(`${p.fields.subject} ${p.fields.preheader}`) ? 'vi' : 'en';
  const house = await houseStyleOf(p.clientId, language, p.id).catch(() => null);
  const inp: GenInput = { goal: 'other', brandName: p.brand.name, brief: `Subject: ${p.fields.subject}\nPreheader: ${p.fields.preheader}`, content: '', tone: '', imageIds: ids, palette: 'auto', language, house };
  onStage('Creative director đang xem bản render…');
  const { ctx } = await buildCtx(inp);
  const html = await reviewDirection(ctx, d, dz.html, p.desktop, p.brand, [], () => onStage('Creative director đang vẽ lại…'));
  if (html === dz.html) return null;
  onStage('Đang tách layer…');
  const conv = await convertDesign(html, d, p.brand, ctx.validIds);
  const used = [...new Set([...flatNodes(conv.doc.nodes), ...(conv.mobile ? flatNodes(conv.mobile.nodes) : [])].filter((n) => n.type === 'image' && n.assetId).map((n) => (n as { assetId: string }).assetId))];
  await assets.persist(used, p.id);
  return { html, ...conv };
}
const EDITOR = `You are the art director editing a finished email because the client asked for a change. You receive the art direction, the current HTML, screenshots of how it renders in Phloem (what subscribers get), the words currently on the canvas, and the request (often in Vietnamese).
1. Do what is asked, and do it beautifully. A vague request ("đẹp hơn", "sang hơn", "trend hơn", "wow hơn", "hợp thương hiệu hơn") means a decisive, VISIBLE upgrade, never a nudge: a stronger hero (bigger type, real overlap, a colour-field or spotlight stage), sharper hierarchy, a fresher move from the TREND RADAR, richer depth (3D object, glass card, grain mesh), better rhythm between sections.
2. Keep what the request does not touch: copy facts, prices, codes, links, image ids, and the palette and fonts unless the request is about them. Use the words currently on the canvas (the user may have edited them there).
3. A CLIENT HOUSE STYLE, when given, always wins: stay on-brand while you change things.
4. Fix any rendering problem you notice on the way (clipped or overlapping text, overflow past 600px, weak contrast, lowercase sentence starts).
Return the COMPLETE revised HTML document in one \`\`\`html block. No commentary.`;

/** "Chỉnh bằng lời": the art director edits the current free-form design as the user asked, looking at its render. */
export async function editDesign(p: Project, request: string, onStage: (m: string) => void, signal?: AbortSignal): Promise<{ html: string; doc: Doc; mobile: Doc | null; brand: Brand; warnings: string[] } | null> {
  const dz = p.design; if (!dz || !dz.dir || !dz.html) return null;
  await loadFluent3d().catch(() => null);
  const d = dz.dir as Direction;
  const ids = [...new Set([...dz.html.matchAll(/data-img="([^"]+)"/g)].map((m) => m[1]).filter((id) => assets.get(id)))];
  const language: 'vi' | 'en' = /[ăâđêôơư]/i.test(`${p.fields.subject} ${p.fields.preheader}`) ? 'vi' : 'en';
  onStage('Đang đọc phong cách khách hàng…');
  const house = await houseStyleOf(p.clientId, language, p.id).catch(() => null);
  const inp: GenInput = { goal: 'other', brandName: p.brand.name, brief: `Subject: ${p.fields.subject}\nPreheader: ${p.fields.preheader}`, content: '', tone: '', imageIds: ids, palette: 'auto', language, house };
  const { ctx } = await buildCtx(inp);
  const words = flatNodes(p.desktop.nodes).filter((n) => n.type === 'text').map((n) => (n as { text: string }).text.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 80);
  const imgs = shots(p.desktop, p.brand);
  onStage('Art director đang xem bản render…');
  const text = await streamClaude({
    system: `${EDITOR}\n\n${DESIGN_CRAFT}\n\n${DESIGN_TECH}\n\nAllowed fonts: ${ctx.fonts}.`,
    turns: [{ role: 'user', text: `${ctx.brief}\n\n${dirText(d)}\n\nIMAGE LIST:\n${ctx.imageLines.join('\n') || '(none)'}\n\nWORDS ON THE CANVAS NOW:\n${words.map((w) => `- ${w}`).join('\n')}\n\nREQUEST: ${request}\n\nThe attached ${imgs.length} screenshot(s) are the current Phloem render, top to bottom (600px wide).\n\nCURRENT HTML:\n\`\`\`html\n${dz.html}\n\`\`\``, images: imgs }],
    maxTokens: 32000, effort: 'high',
  }, () => onStage('Art director đang vẽ lại theo yêu cầu…'), signal);
  const html = extractHtml(text);
  if (!/<(div|section|table)[\s>]/i.test(html) || html === dz.html) return null;
  onStage('Đang tách layer…');
  const conv = await convertDesign(html, d, p.brand, ctx.validIds);
  await readyDoc(conv.doc);
  const used = [...new Set([...flatNodes(conv.doc.nodes), ...(conv.mobile ? flatNodes(conv.mobile.nodes) : [])].filter((n) => n.type === 'image' && n.assetId).map((n) => (n as { assetId: string }).assetId))];
  await assets.persist(used, p.id);
  return { html, ...conv };
}
const flatNodes = (list: Doc['nodes']): Doc['nodes'] => list.flatMap((n) => (n.type === 'group' ? [n, ...flatNodes(n.children)] : [n]));

/** Stable fingerprint of a doc's layers (did the user edit the converted design?). */
export function docHash(doc: Doc): string {
  const s = JSON.stringify(doc.nodes); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${s.length}:${h.toString(36)}`;
}

export { buildCtx };
