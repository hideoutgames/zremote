import SwiftUI

#if os(Android)
// Swift 6.3's Android Foundation declares its own CGFloat/CGRect, and SkipSwiftUI
// declares another set (CGFloat is Double). A module-level alias keeps the Skip types.
typealias CGFloat = SwiftUI.CGFloat
typealias CGPoint = SwiftUI.CGPoint
typealias CGSize = SwiftUI.CGSize
typealias CGRect = SwiftUI.CGRect
#endif
