// Writes web/states.json: one SVG path per state (postal code -> path) on the 975 x 610 Albers USA canvas
// from us-atlas, with Alaska and Hawaii already moved to the lower left. Run after updating us-atlas.
import { readFileSync, writeFileSync } from "node:fs";
import { feature, mesh } from "topojson-client";
import { geoPath } from "d3-geo";

const FIPS = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY" };
const us = JSON.parse(readFileSync(new URL("../node_modules/us-atlas/states-albers-10m.json", import.meta.url)));
const path = geoPath();
const round = (d) => d.replace(/(\d+\.\d{1})\d+/g, "$1");
const states = {};
for (const f of feature(us, us.objects.states).features) {
  const code = FIPS[f.id];
  if (code) states[code] = { d: round(path(f)), c: path.centroid(f).map((v) => Math.round(v)) };
}
writeFileSync(new URL("../web/states.json", import.meta.url), JSON.stringify({ w: 975, h: 610, states }));
console.log(Object.keys(states).length, "states");
