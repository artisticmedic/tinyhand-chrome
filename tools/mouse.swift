// Moves and clicks the guest's real pointer for screenshots.
// mouse move|down|up X Y [alt]   (alt: with the Option key held)
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else {
    print("usage: mouse move|down|up X Y"); exit(2)
}
let p = CGPoint(x: x, y: y)
let type: CGEventType
switch args[1] {
case "move": type = .mouseMoved
case "down": type = .leftMouseDown
case "up": type = .leftMouseUp
default: print("unknown action"); exit(2)
}
let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)
if args.count > 4 && args[4] == "alt" { event?.flags = .maskAlternate }
event?.post(tap: .cghidEventTap)
