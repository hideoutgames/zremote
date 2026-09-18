// LoroValue ⇄ Swift bridging, ported from zeron@853872d
// apps/ios/Zeron/Sync/LoroValueJSON.swift (the module needs the same
// JSON-shaped writes for command/queue rows).

import Foundation
import Loro

extension LoroValue {
  var stringValue: String? {
    if case .string(let v) = self { return v }
    return nil
  }

  var i64Value: Int64? {
    switch self {
    case .i64(let v): return v
    case .double(let v): return Int64(v)
    default: return nil
    }
  }

  var boolValue: Bool? {
    if case .bool(let v) = self { return v }
    return nil
  }

  var listValue: [LoroValue]? {
    if case .list(let v) = self { return v }
    return nil
  }

  var mapValue: [String: LoroValue]? {
    if case .map(let v) = self { return v }
    return nil
  }

  /// Loose JSON-ish projection (deep value → plain Foundation object).
  var jsonObject: Any {
    switch self {
    case .null: return NSNull()
    case .bool(let v): return v
    case .double(let v): return v
    case .i64(let v): return v
    case .binary(let v): return v.base64EncodedString() // JSON has no bytes
    case .string(let v): return v
    case .list(let v): return v.map(\.jsonObject)
    case .map(let v): return v.mapValues(\.jsonObject)
    case .container: return NSNull()
    }
  }

  /// Build a LoroValue from decoded JSON (schema.rs `loro_value_from_json`).
  static func fromJSON(_ any: Any) -> LoroValue {
    switch any {
    case is NSNull: return .null
    case let b as Bool: return .bool(value: b)
    case let n as NSNumber:
      // NSNumber bools are handled above; integers stay i64 like serde.
      if CFNumberIsFloatType(n) { return .double(value: n.doubleValue) }
      return .i64(value: n.int64Value)
    case let s as String: return .string(value: s)
    case let arr as [Any]: return .list(value: arr.map { fromJSON($0) })
    case let dict as [String: Any]: return .map(value: dict.mapValues { fromJSON($0) })
    default: return .null
    }
  }
}
