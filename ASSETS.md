# 그림 교체 규칙

그림은 모두 `assets/` 아래에 있고, 어떤 파일을 쓰는지는 `data/manifest.json`에 적혀 있다.
같은 이름의 PNG로 바꿔 넣으면 게임이 자동으로 기준점(발 위치)을 다시 계산하므로 코드를 고칠 필요가 없다.
프레임 수가 바뀌면 manifest.json의 목록만 늘리거나 줄이면 된다.

| 폴더 | 내용 | 배경 | 기준점 |
| --- | --- | --- | --- |
| assets/sprites/player | 주인공 동작 프레임 (동작명_번호.png) | 투명 | 발 아래 가운데 (자동) |
| assets/monsters/종류 | 몬스터 동작 프레임 | 투명 | 발 아래 가운데 (자동) |
| assets/props | 나무, 덤불, 장식 | 투명 | 아래 가운데 |
| assets/tiles | 바닥 타일 (88x96 기준) | 불투명 | 왼쪽 위 |
| assets/fx | 이펙트 프레임 | 투명 | 가운데 |
| assets/portraits | 대화창 초상화 | 투명 | 가운데 |
| assets/weapons | 무기 단품 | 투명 | 가운데 |

## 주인공 동작 이름

idleD idleU idleR, walkD walkU walkR, runD runU runR, atkD atkR atkU, dodge,
hurtD hurtR, fall lie getup, lowD lowR, hit down cast win

- 끝이 R인 동작은 오른쪽을 보는 그림이고, 왼쪽은 게임이 좌우 반전해서 쓴다
- 모든 프레임은 같은 크기 기준으로 그리고, 발이 같은 높이에 오게 한다
