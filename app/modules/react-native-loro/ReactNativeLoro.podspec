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

  # Only the Nitro bridge lives here; the loro-swift binding is the separate
  # plain-Swift pod `LoroSwift` (vendor/LoroSwift.podspec, module `Loro`).
  s.source_files = 'ios/**/*.swift'
  s.dependency 'LoroSwift'

  s.dependency 'React-Core'
  s.dependency 'NitroModules'

  # Nitrogen-generated Swift<->C++ bridge + interop build settings
  # (SWIFT_OBJC_INTEROP_MODE=objcxx, C++20). Without this the Swift target
  # cannot import NitroModules ("'functional' file not found").
  load File.join(__dir__, 'nitrogen/generated/ios/ReactNativeLoro+autolinking.rb')
  add_nitrogen_files(s)
end
