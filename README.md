# ardesco README

Ericsson Ardesco device development extension

## Features

This extension allows for configuration of VSCode to allow development of Ardesco and other NRF9160 Nordic Semiconductor devices.

It has a set of configuration parameters (in Settings) that are used to preconfigure the CMake extension, as well as dependencies on other needed extensions.

To package: Install vsce (npm install -g vsce) and run vsce package from the root directory of the extension folder.

## Requirements

Needed extensions will be automatically installed.

 - C/C++
 - Cmake
 - Cmake tools
 - Cortex Debug

## Extension Settings

See settings. Will add here later.

## Known Issues

TBD

## Release Notes

### 0.0.1

Initial draft version.

### 0.0.2

Debugging added

### 0.0.3

- Removed board directory validation and added info window after Ardesco: Full Clean

## [0.0.4]

- Updated settings descriptions to be more clear.  Added autogeneration of launch.json for debug if not present. Use cmake clean-configure for Ardesco clean.

## [0.0.5]

- Remove 'ns' non-secure suffix for nrf52840
