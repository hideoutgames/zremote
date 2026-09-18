# Plain-Swift pod for the vendored loro-swift 1.13.3 binding + the UniFFI
# binary. Kept separate from the Nitro pod (ReactNativeLoro) on purpose: with
# Swift/C++ interop enabled, the generated ReactNativeLoro-Swift.h would try to
# expose every public UniFFI type and does not compile. ReactNativeLoro
# depends on this module and `import Loro`s it. Added to the Podfile by
# plugins/withPodfileMods.js.
Pod::Spec.new do |s|
  s.name         = 'LoroSwift'
  s.module_name  = 'Loro'
  s.version      = '1.13.3'
  s.summary      = 'loro-swift 1.13.3 binding (vendored) over the loroFFI xcframework'
  s.license      = 'MIT'
  s.author       = 'loro-dev'
  s.homepage     = 'https://github.com/loro-dev/loro-swift'
  s.source       = { :git => 'https://github.com/loro-dev/loro-swift.git', :tag => '1.13.3' }
  s.platforms    = { :ios => '17.0' }
  s.swift_version = '5.9'

  s.source_files = 'loro-swift/Sources/Loro/**/*.swift'
  # Downloaded + sha256-verified by scripts/fetch-loro-ffi.sh (not committed).
  s.vendored_frameworks = 'loroFFI.xcframework'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }

  s.prepare_command = <<-CMD
    bash ../../../scripts/fetch-loro-ffi.sh "#{__dir__}/.." || exit 1
  CMD
end
