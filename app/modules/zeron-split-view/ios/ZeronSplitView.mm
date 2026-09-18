// ⚠️ WRITTEN BUT UNVERIFIED — never compiled; verify on a Mac
// (docs/NATIVE_MODULES.md). Fabric component view bridging the codegen spec
// (ZeronSplitViewNativeComponent.ts) to ZeronSplitView.swift.

#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

#if __has_include("ZeronSplitView-Swift.h")
#import "ZeronSplitView-Swift.h"
#elif __has_include(<zeron_split_view/zeron_split_view-Swift.h>)
#import <zeron_split_view/zeron_split_view-Swift.h>
#endif

#import <react/renderer/components/ZeronSplitViewSpecs/ComponentDescriptors.h>
#import <react/renderer/components/ZeronSplitViewSpecs/EventEmitters.h>
#import <react/renderer/components/ZeronSplitViewSpecs/Props.h>
#import <react/renderer/components/ZeronSplitViewSpecs/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface ZeronSplitViewComponentView : RCTViewComponentView
@end

@implementation ZeronSplitViewComponentView {
  ZeronSplitViewContainer *_container;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ZeronSplitViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _container = [ZeronSplitViewContainer new];
    self.contentView = _container;
    __weak __typeof(self) weakSelf = self;
    _container.onDisplayModeChange = ^(NSNumber *mode) {
      __typeof(self) strongSelf = weakSelf;
      if (strongSelf == nil) return;
      const auto &emitter =
          *static_cast<const ZeronSplitViewEventEmitter *>(strongSelf->_eventEmitter.get());
      emitter.onDisplayModeChange({.displayMode = mode.doubleValue});
    };
  }
  return self;
}

- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)child index:(NSInteger)index
{
  [_container mountColumn:child at:(int)index];
}

- (void)updateProps:(Props::Shared const &)props
           oldProps:(Props::Shared const &)oldProps
{
  const auto &p = *static_cast<const ZeronSplitViewProps *>(props.get());
  _container.preferredDisplayMode = @(p.preferredDisplayMode);
  _container.presentsWithGesture = p.presentsWithGesture;
  [super updateProps:props oldProps:oldProps];
}

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  if ([commandName isEqualToString:@"collapse"]) {
    [_container collapse];
  } else if ([commandName isEqualToString:@"expand"]) {
    [_container expand];
  }
}

@end

Class<RCTComponentViewProtocol> ZeronSplitViewCls(void)
{
  return ZeronSplitViewComponentView.class;
}
