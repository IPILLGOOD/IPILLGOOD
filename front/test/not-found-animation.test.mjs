import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gzipSync } from "node:zlib";

const asset = new URL("../public/projects/ipillgood/scene-404/lottie.json", import.meta.url);

test("filled shapes paint strokes on top, matching the static SVG fallback", () => {
  const animation = JSON.parse(readFileSync(asset, "utf8"));
  for (const layer of animation.layers) {
    for (const group of layer.shapes ?? []) {
      const fill = group.it.findIndex((item) => item.ty === "fl");
      const stroke = group.it.findIndex((item) => item.ty === "st");
      if (fill < 0 || stroke < 0) continue;
      // Lottie paints styles in reverse array order, unlike an SVG element.
      assert.ok(stroke < fill, `${layer.nm}: fill must not cover the inner half of the stroke`);
    }
  }
});

test("the hand holds the handle at its rotation pivot, outside the lens", () => {
  const animation = JSON.parse(readFileSync(asset, "utf8"));
  const layer = (name) => {
    const value = animation.layers.find((item) => item.nm === name);
    assert.ok(value, `Missing ${name}`);
    return value;
  };
  const glass = layer("Magnifying glass");
  const hand = layer("Handle grip");
  const arm = layer("Holding arm");
  const handle = layer("Handle");
  const lens = layer("Lens");
  assert.equal(hand.parent, glass.ind);
  assert.equal(handle.parent, glass.ind);
  assert.equal(lens.parent, glass.ind);
  assert.equal(arm.parent, glass.parent);
  assert.deepEqual(hand.ks.p, { a: 0, k: [0, 0] });
  assert.deepEqual(glass.ks.a, { a: 0, k: [0, 0] });
  assert.equal(glass.ks.p.a, 0);
  const armPath = arm.shapes.flatMap((group) => group.it).find((item) => item.ty === "sh").ks.k;
  assert.deepEqual(armPath.v.at(-1), glass.ks.p.k);
  const palm = hand.shapes.flatMap((group) => group.it).find((item) => item.ty === "el");
  assert.deepEqual(palm.p.k, [0, 0]);
  const handlePath = handle.shapes.at(-1).it.find((item) => item.ty === "sh").ks.k;
  const [start, end] = handlePath.v;
  assert.equal(start[0] * end[1] - start[1] * end[0], 0, "handle passes through the grip");
  assert.ok(start[0] * end[0] + start[1] * end[1] < 0, "grip is between handle endpoints");
  const rim = lens.shapes.flatMap((group) => group.it).filter((item) => item.ty === "el").sort((a, b) => b.s.k[0] - a.s.k[0])[0];
  assert.ok(Math.hypot(...rim.p.k) > (rim.s.k[0] + Math.max(...palm.s.k)) / 2, "hand stays outside the lens");
});

test("404 artwork stays small and vector-only, with matching poses and velocities at the loop seam", () => {
  const data = readFileSync(asset);
  const animation = JSON.parse(data);
  assert.ok(data.length < 16 * 1024);
  assert.ok(gzipSync(data).length < 2 * 1024);
  assert.equal(animation.fr, 30);
  assert.ok((animation.op - animation.ip) / animation.fr < 5);
  assert.deepEqual(animation.assets, []);
  assert.ok(animation.layers.length < 20);
  assert.ok(animation.layers.every((layer) => [3, 4].includes(layer.ty)));
  assert.doesNotMatch(data.toString(), /https?:|"ef":|"x":\s*"/);
  for (const layer of animation.layers) {
    for (const property of Object.values(layer.ks)) {
      if (property.a !== 1) continue;
      const [first, second] = property.k;
      const penultimate = property.k.at(-2);
      const last = property.k.at(-1);
      assert.equal(first.t, animation.ip);
      assert.equal(last.t, animation.op);
      assert.deepEqual(first.s, last.s);
      for (let axis = 0; axis < first.s.length; axis++) {
        const leaving = (second.s[axis] - first.s[axis]) / (second.t - first.t) * first.o.y[0] / first.o.x[0];
        const arriving = (last.s[axis] - penultimate.s[axis]) / (last.t - penultimate.t) * (1 - penultimate.i.y[0]) / (1 - penultimate.i.x[0]);
        assert.ok(Math.abs(leaving - arriving) < 1e-8, `${layer.nm}: velocity must not jump when the loop wraps`);
      }
    }
    if (["Pill looking for the way home", "Magnifying glass"].includes(layer.nm)) {
      const rotation = layer.ks.r.k;
      assert.notDeepEqual(rotation[0].s, rotation[1].s, `${layer.nm}: no frozen opening segment`);
      assert.notDeepEqual(rotation.at(-2).s, rotation.at(-1).s, `${layer.nm}: no frozen closing segment`);
    }
  }
});

test("static fallback has the same dimensions and no scripts or external dependencies", () => {
  const poster = readFileSync(new URL("../public/projects/ipillgood/scene-404/poster.svg", import.meta.url), "utf8");
  assert.match(poster, /viewBox="0 0 480 320"/);
  assert.doesNotMatch(poster, /<script|<image|<foreignObject|\shref=|\son\w+=/i);
  assert.ok(Buffer.byteLength(poster) < 5 * 1024);
});
