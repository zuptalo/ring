// mp4box ships no types; we use it loosely (demuxing for the WebCodecs path).
declare module 'mp4box' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MP4Box: any;
  export default MP4Box;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const DataStream: any;
}
