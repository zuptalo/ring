/** Minimal ambient declaration so the app type-checks whether or not
 *  @types/qrcode is installed. Only the surface we use. */
declare module 'qrcode' {
  export interface QRCodeToDataURLOptions {
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  }
  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions,
  ): Promise<string>;
  const api: { toDataURL: typeof toDataURL };
  export default api;
}
