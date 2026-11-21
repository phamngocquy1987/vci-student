"""Generate a dependency-free Xcode project from the Swift sources."""
import hashlib
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'ios'
entries = []


def uid(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()


def obj(name, body):
    key = uid(name)
    entries.append(f'\t\t{key} = {{ {body} }};')
    return key


sources = sorted((root / 'VCIStudent').glob('*.swift'))
refs, builds = [], []
for source in sources:
    ref = obj('file:' + source.name, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "{source.name}"; sourceTree = "<group>";')
    refs.append(ref)
    builds.append(obj('build:' + source.name, f'isa = PBXBuildFile; fileRef = {ref};'))
asset_ref = obj('file:Assets.xcassets', 'isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>";')
refs.append(asset_ref)
asset_build = obj('build:Assets.xcassets', f'isa = PBXBuildFile; fileRef = {asset_ref};')
product = obj('product', 'isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = VCIStudent.app; sourceTree = BUILT_PRODUCTS_DIR;')
source_group = obj('source-group', f'isa = PBXGroup; children = ({",".join(refs)},); path = VCIStudent; sourceTree = "<group>";')
products = obj('products', f'isa = PBXGroup; children = ({product},); name = Products; sourceTree = "<group>";')
main_group = obj('main-group', f'isa = PBXGroup; children = ({source_group},{products},); sourceTree = "<group>";')
sources_phase = obj('sources', f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(builds)},); runOnlyForDeploymentPostprocessing = 0;')
frameworks = obj('frameworks', 'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
resources = obj('resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({asset_build},); runOnlyForDeploymentPostprocessing = 0;')
project_configs, target_configs = [], []
for config in ['Debug', 'Release']:
    debug = config == 'Debug'
    project_configs.append(obj('project-config:' + config, 'isa = XCBuildConfiguration; buildSettings = {' +
        'CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; ' +
        ('DEBUG_INFORMATION_FORMAT = dwarf; SWIFT_OPTIMIZATION_LEVEL = "-Onone"; SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG; ONLY_ACTIVE_ARCH = YES;' if debug else 'DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym"; SWIFT_COMPILATION_MODE = wholemodule; SWIFT_OPTIMIZATION_LEVEL = "-O"; VALIDATE_PRODUCT = YES;') +
        f' }}; name = {config};'))
    plist = 'Info-Debug.plist' if debug else 'Info.plist'
    target_configs.append(obj('target-config:' + config, 'isa = XCBuildConfiguration; buildSettings = {' +
        f'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = NO; INFOPLIST_FILE = "Config/{plist}"; ' +
        'LD_RUNPATH_SEARCH_PATHS = ("$(inherited)","@executable_path/Frameworks",); MARKETING_VERSION = 0.1.0; PRODUCT_BUNDLE_IDENTIFIER = vn.edu.vci.student.dev; PRODUCT_NAME = "$(TARGET_NAME)"; SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"; SUPPORTS_MACCATALYST = NO; TARGETED_DEVICE_FAMILY = "1,2";' +
        f' }}; name = {config};'))
project_config_list = obj('project-config-list', f'isa = XCConfigurationList; buildConfigurations = ({",".join(project_configs)},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
target_config_list = obj('target-config-list', f'isa = XCConfigurationList; buildConfigurations = ({",".join(target_configs)},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
target = obj('target', f'isa = PBXNativeTarget; buildConfigurationList = {target_config_list}; buildPhases = ({sources_phase},{frameworks},{resources},); buildRules = (); dependencies = (); name = VCIStudent; productName = VCIStudent; productReference = {product}; productType = "com.apple.product-type.application";')
project = obj('project', f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 1600; }}; buildConfigurationList = {project_config_list}; compatibilityVersion = "Xcode 14.0"; developmentRegion = vi; hasScannedForEncodings = 0; knownRegions = (vi,en,Base,); mainGroup = {main_group}; productRefGroup = {products}; projectDirPath = ""; projectRoot = ""; targets = ({target},);')
destination = root / 'VCIStudent.xcodeproj'
destination.mkdir(exist_ok=True)
(destination / 'project.pbxproj').write_text('// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 56;\n\tobjects = {\n' + '\n'.join(entries) + f'\n\t}};\n\trootObject = {project};\n}}\n', encoding='utf-8')
print(f'Generated Xcode project: {len(sources)} Swift source files.')
