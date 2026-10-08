import {binarize} from "./binarizer";
import {BitMatrix} from "./BitMatrix";
import {Chunks} from "./decoder/decodeData";
import {decode} from "./decoder/decoder";
import {extract} from "./extractor";
import {locate, Point} from "./locator";

export interface QRCode {
  binaryData: number[];
  data: string;
  chunks: Chunks;
  version: number;
  location: {
    topRightCorner: Point;
    topLeftCorner: Point;
    bottomRightCorner: Point;
    bottomLeftCorner: Point;

    topRightFinderPattern: Point;
    topLeftFinderPattern: Point;
    bottomLeftFinderPattern: Point;

    bottomRightAlignmentPattern?: Point;
  };
}

function scan(matrix: BitMatrix): QRCode | null {
  const locations = locate(matrix);
  if (!locations) {
    return null;
  }

  for (const location of locations) {
    const extracted = extract(matrix, location);
    const decoded = decode(extracted.matrix);
    if (decoded) {
      return {
        binaryData: decoded.bytes,
        data: decoded.text,
        chunks: decoded.chunks,
        version: decoded.version,
        location: {
          topRightCorner: extracted.mappingFunction(location.dimension, 0),
          topLeftCorner: extracted.mappingFunction(0, 0),
          bottomRightCorner: extracted.mappingFunction(location.dimension, location.dimension),
          bottomLeftCorner: extracted.mappingFunction(0, location.dimension),

          topRightFinderPattern: location.topRight,
          topLeftFinderPattern: location.topLeft,
          bottomLeftFinderPattern: location.bottomLeft,

          bottomRightAlignmentPattern: location.alignmentPattern,
        },
      };
    }
  }
  return null;
}

export interface Options {
  inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst";
}

const defaultOptions: Options = {
  inversionAttempts: "attemptBoth",
};

function jsQR(data: Uint8ClampedArray, width: number, height: number, providedOptions: Options = {}): QRCode | null {

  // Ember: upstream copied the options onto the shared defaults object, so
  // one call's options leaked into the next. A fresh object each call.
  const options: Options = { ...defaultOptions, ...providedOptions };

  const shouldInvert = options.inversionAttempts === "attemptBoth" || options.inversionAttempts === "invertFirst";
  const tryInvertedFirst = options.inversionAttempts === "onlyInvert" || options.inversionAttempts === "invertFirst";
  const {binarized, inverted} = binarize(data, width, height, shouldInvert);
  const first = tryInvertedFirst ? inverted : binarized;
  let result = first ? scan(first) : null;
  const second = tryInvertedFirst ? binarized : inverted;
  if (!result && second && (options.inversionAttempts === "attemptBoth" || options.inversionAttempts === "invertFirst")) {
    result = scan(second);
  }
  return result;
}

export default jsQR;
