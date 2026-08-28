// Original IPILLGOOD artwork. Rebuild the Lottie and its identical static fallback:
// node front/scripts/generate-not-found-animation.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const output = fileURLToPath(new URL("../public/projects/ipillgood/scene-404/", import.meta.url));
const width = 480;
const height = 320;
const frames = 132;
const colors = { ink: "#17523d", green: "#207a58", sage: "#e6eee5", backdrop: "#edf3ed", shadow: "#dce6d9", pale: "#f2f6f0", white: "#ffffff", line: "#bdcdbf" };
const still = (value) => ({ a: 0, k: value });
const rgb = (hex) => hex.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16) / 255).concat(1);
const motion = (values, ease = [0.65, 0.05, 0.35, 1]) => ({
  a: 1,
  k: values.map(([t, value], index) => ({
    t, s: Array.isArray(value) ? value : [value],
    ...(index < values.length - 1 ? { o: { x: [ease[0]], y: [ease[1]] }, i: { x: [ease[2]], y: [ease[3]] } } : {}),
  })),
});
// One gentle out-and-back cycle: matching zero velocity at each turn, no end hold.
// Background, shadow, body and wrist share this clock so nothing snaps at the seam.
const loop = (from, to) => motion([[0, from], [frames / 2, to], [frames, from]], [1 / 3, 0, 2 / 3, 1]);
const ellipse = (x, y, w, h, fill, stroke, sw = 3) => ({ type: "ellipse", x, y, w, h, fill, stroke, sw });
const rect = (x, y, w, h, radius, fill, stroke, sw = 3) => ({ type: "rect", x, y, w, h, radius, fill, stroke, sw });
const path = (vertices, incoming, outgoing, closed, fill, stroke, sw = 3) => ({ type: "path", vertices, incoming: incoming ?? vertices.map(() => [0, 0]), outgoing: outgoing ?? vertices.map(() => [0, 0]), closed, fill, stroke, sw });
const line = (vertices, stroke, sw = 3) => path(vertices, null, null, false, null, stroke, sw);
const shape = (name, shapes, transform = {}) => ({ name, shapes, transform });
const group = (name, children, transform = {}) => ({ name, children, transform });

// Back to front. The pill's gentle look-around is the only main gesture.
const scene = [
  shape("Quiet sage backdrop", [ellipse(0, 0, 324, 244, colors.backdrop)], { p: [246, 151], s: loop([100, 100], [101, 101]) }),
  shape("Ground", [ellipse(0, 0, 158, 10, colors.shadow)], { p: loop([239, 270], [234, 270]), s: loop([100, 100], [96, 100]) }),
  shape("Search trail", [
    ellipse(112, 209, 5, 5, colors.line), ellipse(124, 224, 5, 5, colors.line),
    ellipse(142, 234, 5, 5, colors.line), ellipse(163, 239, 5, 5, colors.line),
  ], { o: 65 }),
  group("Pill looking for the way home", [
    shape("Feet", [line([[-21, 68], [-26, 85], [-37, 85]], colors.ink, 2.5), line([[21, 68], [24, 84], [35, 84]], colors.ink, 2.5)]),
    shape("Free hand", [path([[-45, 11], [-62, 27], [-66, 20]], [[0, 0], [6, -2], [1, 5]], [[-10, 3], [-4, 0], [0, 0]], false, null, colors.ink, 2.25)]),
    shape("Capsule", [
      rect(0, 0, 94, 150, 47, colors.white),
      path([[-47, 0], [47, 0], [47, 28], [0, 75], [-47, 28]],
        [[0, 0], [0, 0], [0, 0], [26, 0], [0, 26]],
        [[0, 0], [0, 0], [0, 26], [-26, 0], [0, 0]], true, colors.green),
      // Draw the capsule contour only once, so the lower half cannot look heavier.
      rect(0, 0, 94, 150, 47, null, colors.ink, 1.5),
      line([[-47, 0], [47, 0]], colors.ink, 1.5),
      path([[-31, -26], [-12, -56]], [[0, 0], [-13, 4]], [[0, -13], [0, 0]], false, null, colors.sage, 3.5),
    ]),
    shape("Eyes", [ellipse(-14, 0, 6, 8, colors.ink), ellipse(13, 0, 6, 8, colors.ink)], {
      p: loop([-3, -27], [4, -27]),
      s: motion([[0, [100, 100]], [66, [100, 100]], [69, [100, 12]], [72, [100, 100]], [132, [100, 100]]], [0.2, 0.75, 0.34, 0.94]),
    }),
    shape("Small smile", [path([[-6, -13], [6, -13]], [[0, 0], [-3, 5]], [[3, 5], [0, 0]], false, null, colors.ink, 1.75)]),
    shape("Care heart", [path([[0, 48], [-13, 35], [0, 26], [13, 35]],
      [[5, -5], [0, 6], [-6, -10], [0, -9]],
      [[-5, -5], [0, -9], [6, -10], [0, 6]], true, colors.white)], { p: [0, -4] }),
    shape("Holding arm", [path([[43, 9], [69, 16]], [[0, 0], [-8, 13]], [[10, 17], [0, 0]], false, null, colors.ink, 2.25)]),
    // Rotate around the palm, not the lens: the grip stays attached for the whole loop.
    group("Magnifying glass", [
      shape("Handle", [line([[18, -21], [-12, 14]], colors.ink, 8), line([[15, -17.5], [-9, 10.5]], colors.green, 5)]),
      shape("Lens", [ellipse(32, -38, 66, 66, colors.white, colors.ink, 2), ellipse(32, -38, 52, 52, colors.pale, colors.line, 0.75), path([[15, -41], [28, -57]], [[0, 0], [-8, 1]], [[0, -8], [0, 0]], false, null, colors.white, 3.5)]),
      shape("Handle grip", [ellipse(0, 0, 15, 13, colors.white, colors.ink, 1.25), line([[-3, -3], [3, 1]], colors.ink, 1)]),
    ], { p: [69, 16], r: loop(-12, 8) }),
  ], {
    p: loop([220, 173], [226, 176]),
    r: loop(-14, -6),
  }),
  shape("A little question", [
    path([[-9, -6], [0, -15], [11, -5], [0, 8], [0, 11]],
      [[0, 0], [-6, 0], [0, -6], [0, -7], [0, 0]],
      [[0, -6], [7, 0], [0, 7], [0, 0], [0, 0]], false, null, colors.green, 2.25),
    ellipse(0, 21, 4, 4, colors.green),
  ], { p: [351, 83], r: 12, o: loop(85, 65) }),
];

function property(value, fallback) { return value?.a !== undefined ? value : still(value ?? fallback); }
function transform(values = {}) {
  return { o: property(values.o, 100), r: property(values.r, 0), p: property(values.p, [0, 0]), a: still([0, 0]), s: property(values.s, [100, 100]) };
}
function lottieShape(item) {
  let geometry;
  if (item.type === "ellipse") geometry = { ty: "el", p: still([item.x, item.y]), s: still([item.w, item.h]) };
  else if (item.type === "rect") geometry = { ty: "rc", p: still([item.x, item.y]), s: still([item.w, item.h]), r: still(item.radius) };
  else geometry = { ty: "sh", ks: still({ v: item.vertices, i: item.incoming, o: item.outgoing, c: item.closed }) };
  const styles = [];
  // Lottie paints styles back to front. Stroke must be above fill, just as in SVG;
  // reversing these would hide half the outline when the poster becomes animated.
  if (item.stroke) styles.push({ ty: "st", c: still(rgb(item.stroke)), o: still(100), w: still(item.sw), lc: 2, lj: 2 });
  if (item.fill) styles.push({ ty: "fl", c: still(rgb(item.fill)), o: still(100), r: 1 });
  return { ty: "gr", it: [geometry, ...styles, { ty: "tr", ...transform() }] };
}
let index = 0;
const layers = [];
function flatten(nodes, parent) {
  for (const node of nodes) {
    const ind = ++index;
    layers.push({ ddd: 0, ind, ty: node.children ? 3 : 4, nm: node.name, sr: 1, ks: transform(node.transform), ao: 0,
      ...(parent ? { parent } : {}), ...(node.shapes ? { shapes: [...node.shapes].reverse().map(lottieShape) } : {}),
      ip: 0, op: frames, st: 0, bm: 0 });
    if (node.children) flatten(node.children, ind);
  }
}
flatten(scene);
const animation = { v: "5.13.0", fr: 30, ip: 0, op: frames, w: width, h: height, nm: "IPILLGOOD · A little help finding home", ddd: 0, assets: [], layers: layers.reverse(), markers: [] };

function svgShape(item) {
  const style = `fill="${item.fill ?? "none"}"${item.stroke ? ` stroke="${item.stroke}" stroke-width="${item.sw}" stroke-linecap="round" stroke-linejoin="round"` : ""}`;
  if (item.type === "ellipse") return `<ellipse cx="${item.x}" cy="${item.y}" rx="${item.w / 2}" ry="${item.h / 2}" ${style}/>`;
  if (item.type === "rect") return `<rect x="${item.x - item.w / 2}" y="${item.y - item.h / 2}" width="${item.w}" height="${item.h}" rx="${item.radius}" ${style}/>`;
  let d = `M${item.vertices[0].join(",")}`;
  const add = (a, b) => a.map((v, i) => v + b[i]).join(",");
  for (let i = 1; i < item.vertices.length + Number(item.closed); i++) {
    const prev = i - 1;
    const next = i % item.vertices.length;
    d += `C${add(item.vertices[prev], item.outgoing[prev])} ${add(item.vertices[next], item.incoming[next])} ${item.vertices[next].join(",")}`;
  }
  return `<path d="${d}${item.closed ? "Z" : ""}" ${style}/>`;
}
function initial(value, fallback) { return value?.a === 1 ? value.k[0].s : value ?? fallback; }
function svgNodes(nodes) {
  return nodes.map((node) => {
    const p = initial(node.transform.p, [0, 0]);
    const s = initial(node.transform.s, [100, 100]);
    return `<g transform="translate(${p}) rotate(${initial(node.transform.r, 0)}) scale(${s.map((v) => v / 100)})" opacity="${Number(initial(node.transform.o, 100)) / 100}">${node.children ? svgNodes(node.children) : node.shapes.map(svgShape).join("")}</g>`;
  }).join("");
}
const json = JSON.stringify(animation);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgNodes(scene)}</svg>`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}lottie.json`, json);
writeFileSync(`${output}poster.svg`, svg);
console.log(`404 animation: ${Buffer.byteLength(json)} bytes (${gzipSync(json).length} gzip); poster: ${Buffer.byteLength(svg)} bytes.`);
