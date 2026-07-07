import fs from "node:fs";
const file = "media/tokens.css";
const css = fs.readFileSync(file, "utf8");
const banner = css.indexOf("/* Generated from");
fs.writeFileSync(file, css.slice(banner));
