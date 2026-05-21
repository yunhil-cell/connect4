// 1. Firebase SDK 임포트 (v10)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { getDatabase, ref, set, get, update, onValue, remove, child } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

// [필수] 본인의 Firebase Config로 교체하세요
const firebaseConfig = {
  apiKey: "AIzaSyAzDc8nErqYcYYy-itp2Tk9WZExy3PBlIU",
  authDomain: "battleship-f08f8.firebaseapp.com",
  databaseURL: "https://battleship-f08f8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "battleship-f08f8",
  storageBucket: "battleship-f08f8.firebasestorage.app",
  messagingSenderId: "1146329001",
  appId: "1:1146329001:web:f2d698e5661582ee1f96b8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// 데이터 격리를 위한 루트 노드
const DB_ROOT = "connect4_rooms"; 

// 상태 변수
let myUid = null;
let myTeam = null; // 'red' (방장) or 'blue' (참여자)
let currentRoomCode = null;
let isMyTurn = false;
let localBoard = Array(6).fill().map(() => Array(7).fill(null));
let gameActive = false;

// DOM 요소
const authScreen = document.getElementById('auth-screen');
const gameScreen = document.getElementById('game-screen');
const boardEl = document.getElementById('board');
const turnIndicator = document.getElementById('turn-indicator');
const displayRoomCode = document.getElementById('display-room-code');
const displayMyTeam = document.getElementById('my-team');

// 익명 로그인
signInAnonymously(auth).then((userCred) => {
    myUid = userCred.user.uid;
}).catch((error) => console.error("Auth Error:", error));

// 보드 UI 초기화
function initBoardUI() {
    boardEl.innerHTML = '';
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 7; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = r;
            cell.dataset.col = c;
            cell.addEventListener('click', () => handleCellClick(c));
            boardEl.appendChild(cell);
        }
    }
}
initBoardUI();

// UI/UX 피드백 함수
function triggerFeedback() {
    document.body.classList.remove('hit-flash');
    document.body.classList.remove('screen-shake');
    void document.body.offsetWidth; // 리플로우 강제 트리거 (애니메이션 재시작)
    document.body.classList.add('hit-flash');
    document.body.classList.add('screen-shake');
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
}

// 방 생성 로직
document.getElementById('btn-create').addEventListener('click', async () => {
    if (!myUid) return alert("서버 연결 중입니다. 잠시 후 다시 시도하세요.");
    
    let code;
    let isUnique = false;
    while (!isUnique) {
        code = Math.floor(1000 + Math.random() * 9000).toString();
        const snap = await get(ref(db, `${DB_ROOT}/${code}`));
        if (!snap.exists()) isUnique = true;
    }

    const roomRef = ref(db, `${DB_ROOT}/${code}`);
    await set(roomRef, {
        players: { red: myUid },
        board: JSON.stringify(Array(6).fill().map(() => Array(7).fill(null))),
        turn: 'red',
        status: 'waiting',
        lastMove: null
    });

    joinRoomSession(code, 'red');
});

// 방 참여 로직
document.getElementById('btn-join').addEventListener('click', async () => {
    const code = document.getElementById('room-code-input').value;
    if (!code || code.length !== 4) return alert("4자리 코드를 입력하세요.");
    
    const roomRef = ref(db, `${DB_ROOT}/${code}`);
    const snap = await get(roomRef);
    
    if (!snap.exists()) return alert("존재하지 않는 방입니다.");
    const roomData = snap.val();
    if (roomData.players.blue) return alert("방이 꽉 찼습니다.");

    await update(roomRef, {
        'players/blue': myUid,
        'status': 'playing'
    });

    joinRoomSession(code, 'blue');
});

// 세션 진입 및 동기화 리스너
function joinRoomSession(code, team) {
    currentRoomCode = code;
    myTeam = team;
    
    authScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    displayRoomCode.innerText = code;
    displayMyTeam.innerText = team === 'red' ? '홍팀' : '청팀';
    displayMyTeam.style.color = team === 'red' ? '#e74c3c' : '#3498db';

    const roomRef = ref(db, `${DB_ROOT}/${code}`);
    
    // 데이터 변경 감지 (폭파 감지 포함)
    onValue(roomRef, (snap) => {
        if (!snap.exists()) {
            alert("방이 종료되었거나 폭파되었습니다.");
            location.reload();
            return;
        }

        const data = snap.val();
        
        // 피드백 (새로운 수가 놓였을 때)
        if (data.lastMove && data.lastMove.uid !== myUid) {
            // 이전 수와 다를 때만 피드백
            triggerFeedback();
        }

        // 보드 업데이트
        localBoard = JSON.parse(data.board);
        updateBoardUI();

        // 턴 상태 처리
        if (data.status === 'waiting') {
            turnIndicator.innerText = "상대방 대기 중...";
            gameActive = false;
        } else if (data.status === 'playing') {
            gameActive = true;
            isMyTurn = (data.turn === myTeam);
            if (isMyTurn) {
                turnIndicator.innerText = "내 턴입니다!";
                turnIndicator.style.color = myTeam === 'red' ? '#e74c3c' : '#3498db';
            } else {
                turnIndicator.innerText = "상대 턴입니다...";
                turnIndicator.style.color = "#555";
            }
        } else if (data.status === 'finished') {
            gameActive = false;
            turnIndicator.innerText = data.winner === myTeam ? "승리했습니다! (5초 후 종료)" : "패배했습니다... (5초 후 종료)";
            turnIndicator.style.color = data.winner === myTeam ? "#27ae60" : "#c0392b";
        }
    });
}

// 보드 UI 렌더링
function updateBoardUI() {
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 7; c++) {
            const cell = document.querySelector(`.cell[data-row='${r}'][data-col='${c}']`);
            cell.className = 'cell'; // 초기화
            if (localBoard[r][c]) {
                cell.classList.add(localBoard[r][c]);
            }
        }
    }
}

// 클릭(돌 떨어뜨리기) 처리
async function handleCellClick(col) {
    if (!gameActive || !isMyTurn) return;

    // 중력 적용: 해당 열의 가장 아래 빈 칸 찾기
    let targetRow = -1;
    for (let r = 5; r >= 0; r--) {
        if (!localBoard[r][col]) {
            targetRow = r;
            break;
        }
    }

    if (targetRow === -1) return; // 열이 꽉 참

    // 로컬 적용 및 DB 업데이트
    localBoard[targetRow][col] = myTeam;
    triggerFeedback(); // 내 클릭 시에도 피드백

    const winResult = checkWin(targetRow, col, myTeam);
    
    const updates = {
        board: JSON.stringify(localBoard),
        turn: myTeam === 'red' ? 'blue' : 'red',
        lastMove: { uid: myUid, ts: Date.now() }
    };

    if (winResult) {
        updates.status = 'finished';
        updates.winner = myTeam;
        
        // 승리 돌 깜빡임 UI 즉시 적용
        winResult.forEach(([wr, wc]) => {
            document.querySelector(`.cell[data-row='${wr}'][data-col='${wc}']`).classList.add('winning');
        });
        
        // 5초 후 승리자가 방 폭파
        setTimeout(() => {
            remove(ref(db, `${DB_ROOT}/${currentRoomCode}`));
        }, 5000);
    }

    await update(ref(db, `${DB_ROOT}/${currentRoomCode}`), updates);
}

// 4목 승리 판정 로직
function checkWin(row, col, team) {
    const directions = [
        [[0, 1], [0, -1]], // 가로
        [[1, 0], [-1, 0]], // 세로
        [[1, 1], [-1, -1]], // 우하향 대각선
        [[1, -1], [-1, 1]]  // 좌하향 대각선
    ];

    for (let dir of directions) {
        let count = 1;
        let winningCells = [[row, col]];

        for (let [dr, dc] of dir) {
            let r = row + dr;
            let c = col + dc;
            while (r >= 0 && r < 6 && c >= 0 && c < 7 && localBoard[r][c] === team) {
                count++;
                winningCells.push([r, c]);
                r += dr;
                c += dc;
            }
        }

        if (count >= 4) return winningCells;
    }
    return null;
}

// 관리자 강제 리셋 (방폭)
document.getElementById('btn-reset-all').addEventListener('click', async () => {
    const pw = document.getElementById('admin-pw').value;
    if (pw === 'admin1234') { // 선생님용 간단한 비밀번호 예시
        await remove(ref(db, DB_ROOT));
        alert("모든 방이 초기화되었습니다.");
    } else {
        alert("비밀번호가 틀렸습니다.");
    }
});