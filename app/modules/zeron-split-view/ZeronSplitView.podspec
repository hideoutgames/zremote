# UNVERIFIED — written blind on Windows; podspec paths and the Swift/Obj-C++
# bridging header name must be confirmed by a real `pod install` + build.
require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ZeronSplitView"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.license      = package["license"]
  s.authors      = "zremote"
  s.homepage     = "https://example.invalid"
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://example.invalid", :tag => s.version }
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.dependency "React-Core"
  install_modules_dependencies(s)
end
