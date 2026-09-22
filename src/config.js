import path from "node:path";

const watchDirectory = path.resolve("watch");
const allowedFiletypes = ["csv", "zip", "ofx"];

export { allowedFiletypes, watchDirectory };
