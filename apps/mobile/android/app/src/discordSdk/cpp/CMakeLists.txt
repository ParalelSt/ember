# The JNI shim over Discord's Social SDK. The SDK comes from its aar's prefab
# module, from outside the repository (see app/build.gradle and docs/APPS.md).
cmake_minimum_required(VERSION 3.22.1)
project(ember_discord CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(discord_partner_sdk REQUIRED CONFIG)

add_library(ember_discord SHARED ember_discord.cpp)
target_link_libraries(ember_discord PRIVATE discord_partner_sdk::discord_partner_sdk)
target_link_options(ember_discord PRIVATE "-Wl,-z,max-page-size=16384")
