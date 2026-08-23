# Agent Note：provider 错误信息在 wire 面脱敏

Status: implemented

[English](2026-08-22-provider-error-sanitization.md) | 中文

## Problem

`session.search` 等服务在提供方（provider）出错时，错误信息可能携带后端内部细节——路径、引擎消息、实现痕迹。宿主把这类信息直接送回 wire 面，会让网关的每个调用方（单用户本地服务之外的载体，例如把网关暴露给多名用户的 carrier）看到 provider 内部结构。

## Decision

宿主侧在 wire 边界把 provider 细节替换为 public-safe diagnostic：完整内部信息只进宿主日志（可排查），wire 面只出现脱敏后的通用诊断。本地单用户直连场景不受影响——脱敏发生在"错误要流到 wire"的那一步，而不是 provider 本身。

## Alternatives considered

- 完全透传：对单用户本地服务最简单，但网关一旦被多用户复用就泄露内部细节；没有把"本地直连"与"转发暴露"两种形态分开的开关。
- 彻底吞掉错误：排查无从下手；宿主日志保留完整信息，兼顾排查与安全。

## Consequences

- wire 面的 `session.search` 错误只含通用诊断；宿主日志是内部细节的唯一出口。
- 测试断言 wire 面不出现 provider 内部字符串（api-proxy-search.spec 覆盖）。
- 其它 RPC 方法沿用同一边界：凡 provider 细节可能进入响应的，一律在 wire 边界脱敏。
