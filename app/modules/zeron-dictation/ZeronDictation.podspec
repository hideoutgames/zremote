require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'ZeronDictation'
  s.version      = package['version']
  s.summary      = 'On-device speech dictation via Nitro (iOS Speech framework)'
  s.license      = 'MIT'
  s.author       = 'zremote'
  s.homepage     = 'https://example.invalid'
  s.source       = { :git => '' }
  s.platforms    = { :ios => '17.0' }

  s.source_files = 'ios/**/*.swift'
  s.frameworks   = 'Speech', 'AVFAudio'

  s.dependency 'React-Core'
  s.dependency 'NitroModules'
  # Nitrogen-generated Swift<->C++ bridge + interop build settings
  # (SWIFT_OBJC_INTEROP_MODE=objcxx, C++20). Without this the Swift target
  # cannot import NitroModules ("'functional' file not found").
  load File.join(__dir__, 'nitrogen/generated/ios/ZeronDictation+autolinking.rb')
  add_nitrogen_files(s)
end
