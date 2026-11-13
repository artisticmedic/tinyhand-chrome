// key altdown | altup : holds or releases the Option key in the guest.
import CoreGraphics
let down = CommandLine.arguments[1] == "altdown"
let e = CGEvent(keyboardEventSource: nil, virtualKey: 58, keyDown: down)
e?.flags = down ? .maskAlternate : []
e?.post(tap: .cghidEventTap)
