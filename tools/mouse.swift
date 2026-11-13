// Moves and clicks the guest's real pointer for screenshots.
// mouse move X Y | mouse down X Y | mouse up X Y
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count == 4, let x = Double(args[2]), let y = Double(args[3]) else {
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
CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
