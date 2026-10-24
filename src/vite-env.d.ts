declare module "zxing-wasm/reader/zxing_reader.wasm?url" {
  const url: string;
  export default url;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}
