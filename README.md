# Open Perfboard

<p align="center">
  <img src="images/logo.png" alt="Open Perfboard 로고" width="160" />
</p>

<p align="center">
  <b>Open-Perfboard</b><br />
  찍고 이으면 설계와 문서 작성이 되는 All-in-One Offline Design Program
</p>

<div align="center">

[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-15803d)](../../releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6)](#설치)
![Offline](https://img.shields.io/badge/offline-no%20account%20needed-555)

[English](README.en.md) · [설치](#설치) · [사용법](#사용법) · [의견 보내기](#의견-보내기) · [개발 계획](#개발-계획)

</div>

![동작 모습](images/demo.gif)

> 지금은 **기능을 확인하는 단계**입니다. [의견](#의견-보내기)을 남겨 주시면 다음 방향에 반영하겠습니다.

## 기능

- **사진 위에 핀 찍기**: 부품 사진의 단자를 클릭해 핀 등록, 데이터시트 PDF 첨부
- **핀과 핀 잇기**: 직각 배선, 분기, 교차 점프. 전선은 부품을 가로지르지 않음
- **결선표·부품표 자동 생성**: 전선 색·규격·길이, 단가·합계, 구매 링크
- **내보내기**: PDF 보고서, 엑셀·CSV, PNG
- **그 밖에**: 자동 저장·복구, 부품함 공유(`.opblib`), 한국어/English, 부품·전선 수 제한 없음

| 부품 편집기 | 전선 스펙 |
| --- | --- |
| ![부품 편집기: 사진 위에 커넥터별 핀을 찍은 모습](images/part-editor.png) | ![전선 선택: 규격·길이·색·라벨](images/wire.png) |
| **부품표 (BOM)** | **결선표** |
| ![BOM: 참조명·이름·품번·수량·단가·금액·구매 링크](images/bom.png) | ![결선표: 시작·끝 핀, 신호, 색, 규격, 길이](images/netlist.png) |

## 설치

Windows 10 / 11 (64비트). Linux는 지원 예정입니다.

1. [Releases](../../releases/latest)에서 `Open Perfboard Setup <버전>.exe` 내려받기
2. 실행 (관리자 권한 불필요)

> "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**을 누르세요.

## 사용법

1. **부품 만들기**: 부품함 **＋ 새 부품** → 사진 선택 → 단자 클릭으로 핀 찍기
2. **배치**: 부품을 캔버스로 끌어다 놓기
3. **잇기**: `W` → 핀 클릭 → 다른 핀 클릭 (빈 곳 클릭 = 꺾기)
4. **내보내기**: 위쪽 **BOM / 결선표** 확인 → **내보내기 ▾**

![최종 사진](images/main.png)

| 키 | 동작 | 키 | 동작 |
| --- | --- | --- | --- |
| `V` / `W` | 선택 / 배선 모드 | `R` / `F` | 회전 / 반전 |
| `Esc` | 그리기 취소 | `Delete` | 삭제 |
| `Ctrl+Z` / `Ctrl+Y` | 실행 취소 / 다시 | `Home` | 전체 보기 |
| 휠 | 확대 / 축소 | `Space`+드래그 | 화면 이동 |

전체 단축키는 앱의 **?** 버튼(`F1`)에서 볼 수 있습니다.

## 의견 보내기

- [이슈](../../issues/new)로 불편했던 점이나 개선할 점을 알려 주세요.
- 마음에 드셨다면 **⭐ 별** 하나가 큰 힘이 됩니다.

## 개발 계획

1. 전선 절단표
2. 하우징·연결 단자 부품
3. Linux 지원
4. 회로도(Schematic)
5. KiCad 연동
6. AI 부품 등록

최종 목표는 **펌웨어 컴파일과 시뮬레이션(SILS·HILS)** 까지 이 앱에서 하는 것입니다.

## 개발

Node.js 22 이상이 필요합니다.

```bash
npm ci              # 의존성 설치
npm run dev         # 개발 실행
npm run check       # 타입 검사 + 단위 테스트
npm run test:e2e    # E2E 테스트
npm run dist:win    # 설치 파일 만들기 → dist/
```

## 라이선스

[GPL-3.0-or-later](LICENSE). 누구나 쓰고 고칠 수 있으며, 고친 것을 배포할 때는 소스도 공개해야 합니다.

> 본 프로젝트는 CLAUDE Code로 개발되었습니다.
