// HybridLoroDoc — Nitro HybridObject over loro-swift 1.13.3.
//
// IMPLEMENTED-BUT-UNVERIFIED: written on Windows; first compiled on a Mac
// (docs/NATIVE_MODULES.md). API calls mirror apps/ios/Zeron/Sync/
// SessionStore.swift + SessionQueue.swift + DocDisk.swift at 853872d.

import Foundation
import NitroModules

class HybridLoroDoc: HybridLoroDocSpec {
  private let doc = LoroDoc()
  private var nextSubId: Double = 1
  private var subs: [Double: Subscription] = [:]

  // MARK: bytes / versions

  func importBytes(bytes: ArrayBuffer) throws {
    _ = try doc.importWith(bytes: bytes.toData(copyIfNeeded: false), origin: "remote")
  }

  func exportUpdatesFrom(vv: ArrayBuffer?) throws -> ArrayBuffer {
    let mode: ExportMode
    if let vv {
      mode = .updates(from: try VersionVector.decode(bytes: vv.toData(copyIfNeeded: false)))
    } else {
      mode = .updates(from: VersionVector())
    }
    return try ArrayBuffer.copy(data: doc.export(mode: mode))
  }

  func exportSnapshot() throws -> ArrayBuffer {
    try ArrayBuffer.copy(data: doc.export(mode: .snapshot))
  }

  func oplogVersionEncoded() throws -> ArrayBuffer {
    try ArrayBuffer.copy(data: doc.oplogVv().encode())
  }

  /// containsFrontier semantics: decode-fail AND decoded-empty both return
  /// false (the vacuous-claim rule mirrored from the loro-crdt adapter).
  func oplogIncludes(vv: ArrayBuffer) throws -> Bool {
    guard let other = try? VersionVector.decode(bytes: vv.toData(copyIfNeeded: false)),
          !other.toHashmap().isEmpty
    else { return false }
    return doc.oplogVv().includesVv(other: other)
  }

  func toJSONString() throws -> String {
    let obj = doc.getDeepValue().jsonObject
    guard JSONSerialization.isValidJSONObject(obj),
          let data = try? JSONSerialization.data(withJSONObject: obj)
    else { return "null" }
    return String(decoding: data, as: UTF8.self)
  }

  // MARK: subscriptions

  func subscribeLocalUpdates(cb: @escaping (ArrayBuffer) -> Void) throws -> Double {
    let id = nextSubId
    nextSubId += 1
    subs[id] = doc.subscribeLocalUpdate(callback: { update in
      cb(try! ArrayBuffer.copy(data: update))
    })
    return id
  }

  func unsubscribe(id: Double) throws {
    subs.removeValue(forKey: id)?.unsubscribe()
  }

  func commit() throws {
    doc.commit()
  }

  // MARK: plain-list map writes (command log)

  /// list.pushContainer(new LoroMap()) + LoroValue.fromJSON per field
  /// (schema.rs loro_value_from_json semantics).
  func pushMapToList(listId: String, fieldsJson: String) throws {
    let list = doc.getList(id: listId)
    let map = try list.insertMapContainer(pos: list.len(), child: LoroMap())
    for (key, value) in try decodeFields(fieldsJson) {
      try map.insert(key: key, v: LoroValue.fromJSON(value))
    }
  }

  func setListMapField(listId: String, index: Double, key: String, valueJson: String) throws {
    let list = doc.getList(id: listId)
    guard let map = list.get(index: UInt32(index))?.asLoroMap() else { return }
    try map.insert(key: key, v: LoroValue.fromJSON(decodeValue(valueJson)))
  }

  // MARK: movable list (queue)

  func movableListLength(listId: String) throws -> Double {
    Double(doc.getMovableList(id: listId).len())
  }

  func movableListPushMap(listId: String, fieldsJson: String) throws {
    let list = doc.getMovableList(id: listId)
    let map = try list.insertMapContainer(pos: list.len(), child: LoroMap())
    for (key, value) in try decodeFields(fieldsJson) {
      try map.insert(key: key, v: LoroValue.fromJSON(value))
    }
  }

  func movableListDelete(listId: String, index: Double, len: Double) throws {
    try doc.getMovableList(id: listId).delete(pos: UInt32(index), len: UInt32(len))
  }

  func movableListMove(listId: String, from: Double, to: Double) throws {
    try doc.getMovableList(id: listId).mov(from: UInt32(from), to: UInt32(to))
  }

  func movableListSetField(listId: String, index: Double, key: String, valueJson: String) throws {
    let list = doc.getMovableList(id: listId)
    guard let map = list.get(index: UInt32(index))?.asLoroMap() else { return }
    try map.insert(key: key, v: LoroValue.fromJSON(decodeValue(valueJson)))
  }

  func movableListDeleteField(listId: String, index: Double, key: String) throws {
    let list = doc.getMovableList(id: listId)
    guard let map = list.get(index: UInt32(index))?.asLoroMap() else { return }
    try map.delete(key: key)
  }

  // MARK: JSON helpers

  private func decodeFields(_ json: String) throws -> [String: Any] {
    guard let obj = try JSONSerialization.jsonObject(
      with: Data(json.utf8)
    ) as? [String: Any] else {
      throw NSError(domain: "react-native-loro", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "fieldsJson is not an object"])
    }
    return obj
  }

  private func decodeValue(_ json: String) throws -> Any {
    try JSONSerialization.jsonObject(with: Data(json.utf8))
  }
}
