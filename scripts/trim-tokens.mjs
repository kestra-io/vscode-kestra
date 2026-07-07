// Drops the palette's own header comments from the compiled output, keeping our banner as line one.
import fs from "node:fs";
const file = "media/tokens.css";
const css = fs.readFileSync(file, "utf8");
const banner = css.indexOf("/* Generated from");
fs.writeFileSync(file, css.slice(banner));
