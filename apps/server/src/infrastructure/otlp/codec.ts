import type { OtlpCodec } from "../../application/ingest.js";
import {
  decodeOtlpTraceRequest,
  encodeOtlpTraceResponse,
} from "./decoder.js";

export const otlpCodec: OtlpCodec = {
  decode: decodeOtlpTraceRequest,
  encodeResponse: encodeOtlpTraceResponse,
};
