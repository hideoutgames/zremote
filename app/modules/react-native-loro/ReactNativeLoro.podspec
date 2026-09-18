require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'ReactNativeLoro'
  s.version      = package['version']
  s.summary      = 'Nitro bridge over loro-swift 1.13.3 for Zeron session docs'
  s.license      = 'MIT'
  s.author       = 'zremote'
  s.homepage     = 'https://example.invalid'
  s.source       = { :git => '' }
  s.platforms    = { :ios => '17.0' }

  # Module Swift + vendored loro-swift binding sources.
  s.source_files = 'ios/**/*.swift', 'vendor/loro-swift/Sources/Loro/**/*.swift'
  # The FFI binary (downloaded + checksum-verified by scripts/fetch-loro-ffi.sh).
  s.vendored_frameworks = 'vendor/loroFFI.xcframework'
  # The Swift→C++ interop header (ReactNativeLoro-Swift.h) exposes the
  # vendored UniFFI types, which reference the C `RustBuffer`; declare it
  # ahead of every C/C++/ObjC++ compile unit in this pod.
  s.prefix_header_contents = '#include <loroFFI/loroFFI.h>'

  s.dependency 'React-Core'
  s.dependency 'NitroModules'

  s.prepare_command = <<-CMD
    bash ../../scripts/fetch-loro-ffi.sh "#{__dir__}" || exit 1
  CMD
  # Nitrogen-generated Swift<->C++ bridge + interop build settings
  # (SWIFT_OBJC_INTEROP_MODE=objcxx, C++20). Without this the Swift target
  # cannot import NitroModules ("'functional' file not found").
  load File.join(__dir__, 'nitrogen/generated/ios/ReactNativeLoro+autolinking.rb')
  add_nitrogen_files(s)
end
