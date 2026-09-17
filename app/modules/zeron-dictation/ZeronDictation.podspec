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
end
