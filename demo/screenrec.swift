// Records one on-screen window's area plus all system audio to a .mov with
// ScreenCaptureKit, until a stop file appears.
//
//   screenrec <window title> <out.mov> <stop file>
//
// The capture is the whole display cropped to the window, not the window
// alone: a window filter would only carry that app's audio, and the inline
// player's sound comes from ffmpeg, another process.
import AppKit
import CoreMedia
import Foundation
import ScreenCaptureKit

let args = CommandLine.arguments
guard args.count == 4 else {
  FileHandle.standardError.write("usage: screenrec <window title> <out.mov> <stop file>\n".data(using: .utf8)!)
  exit(2)
}
let title = args[1]
let outURL = URL(fileURLWithPath: args[2])
let stopPath = args[3]

final class Recorder: NSObject, SCRecordingOutputDelegate, SCStreamDelegate {
  func recordingOutputDidStartRecording(_ output: SCRecordingOutput) {
    print("recording")
    fflush(stdout)
  }
  func recordingOutput(_ output: SCRecordingOutput, didFailWithError error: Error) {
    print("error recording: \(error)")
    exit(1)
  }
  func recordingOutputDidFinishRecording(_ output: SCRecordingOutput) {
    print("finished \(outURL.path)")
    exit(0)
  }
  func stream(_ stream: SCStream, didStopWithError error: Error) {
    print("error stream: \(error)")
    exit(1)
  }
}

let recorder = Recorder()

Task {
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let matches = content.windows.filter {
      $0.owningApplication?.bundleIdentifier == "com.mitchellh.ghostty" && $0.title == title
    }
    guard matches.count == 1, let window = matches.first else {
      print("error expected one Ghostty window titled \"\(title)\", found \(matches.count)")
      exit(1)
    }
    guard let display = content.displays.first(where: { $0.frame.intersects(window.frame) }) else {
      print("error no display under the window")
      exit(1)
    }

    // The terminal running this recorder titles itself "screenrec"; leave it out
    let hidden = content.windows.filter { $0.title == "screenrec" }
    let filter = SCContentFilter(display: display, excludingWindows: hidden)
    let config = SCStreamConfiguration()
    let crop = window.frame.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
    config.sourceRect = crop
    let scale = CGFloat(filter.pointPixelScale)
    // Even pixel sizes keep H.264 happy
    config.width = Int(crop.width * scale) & ~1
    config.height = Int(crop.height * scale) & ~1
    config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
    config.showsCursor = false
    config.capturesAudio = true
    config.sampleRate = 48000
    config.channelCount = 2

    let stream = SCStream(filter: filter, configuration: config, delegate: recorder)
    let outputConfig = SCRecordingOutputConfiguration()
    outputConfig.outputURL = outURL
    outputConfig.outputFileType = .mov
    outputConfig.videoCodecType = .h264
    let output = SCRecordingOutput(configuration: outputConfig, delegate: recorder)
    try stream.addRecordingOutput(output)
    try await stream.startCapture()

    while !FileManager.default.fileExists(atPath: stopPath) {
      try await Task.sleep(nanoseconds: 200_000_000)
    }
    try await stream.stopCapture()
    // recordingOutputDidFinishRecording exits; give it time to flush
    try await Task.sleep(nanoseconds: 10_000_000_000)
    print("error recording did not finish")
    exit(1)
  } catch {
    print("error \(error)")
    exit(1)
  }
}

// ScreenCaptureKit adds a menu-bar recording indicator, which needs an app run loop
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.run()
