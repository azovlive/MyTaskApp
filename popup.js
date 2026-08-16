document.addEventListener('DOMContentLoaded', function() {
  const authBtn = document.getElementById('auth-btn');
  const listContainer = document.getElementById('list-container');
  const taskListDiv = document.getElementById('task-list');
  const listTitleEl = document.getElementById('current-list-title');
  const detailPanel = document.getElementById('detailPanel');
  const closeBtn = document.getElementById('close-btn');
  
  const navToday = document.getElementById('nav-today');
  
  const editTitle = document.getElementById('editTitle');
  const editDue = document.getElementById('editDue');
  const displayDueText = document.getElementById('displayDueText');
  const editNotes = document.getElementById('editNotes');
  const saveBtn = document.getElementById('save-btn');
  const deleteBtn = document.getElementById('delete-btn');

  const addTaskContainer = document.getElementById('add-task-container');
  const newTaskInput = document.getElementById('newTaskInput');
  const addTaskBtn = document.getElementById('addTaskBtn');

  const addListContainer = document.getElementById('add-list-container');
  const newListInput = document.getElementById('newListInput');
  const addListBtn = document.getElementById('addListBtn');
  const deleteListBtn = document.getElementById('deleteListBtn');

  let currentToken = '';
  let currentListId = ''; 
  let currentTask = null;

  function playCompleteSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      console.error("효과음 재생을 지원하지 않는 환경입니다.", e);
    }
  }

  function setUIAuthenticated(token) {
    currentToken = token;
    authBtn.style.display = 'none';
    addTaskContainer.style.display = 'flex'; 
    addListContainer.style.display = 'flex'; 
    loadTaskLists();
  }

  function setUIUnauthenticated() {
    currentToken = '';
    authBtn.style.display = 'block';
    addTaskContainer.style.display = 'none'; 
    addListContainer.style.display = 'none'; 
    listContainer.innerHTML = '';
    taskListDiv.innerHTML = "구글 계정을 연결해주세요.";
    detailPanel.classList.remove('open');
    deleteListBtn.style.display = 'none';
  }

  chrome.identity.getAuthToken({ interactive: false }, function(token) {
    if (token) setUIAuthenticated(token);
    else setUIUnauthenticated();
  });

  authBtn.addEventListener('click', function() {
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if (chrome.runtime.lastError || !token) {
        alert("로그인 실패: " + chrome.runtime.lastError.message);
        return;
      }
      setUIAuthenticated(token);
    });
  });

  async function fetchAllTasks(listId, token) {
    let allTasks = [];
    let pageToken = '';
    try {
      do {
        const url = `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=true&showHidden=true&maxResults=100${pageToken ? '&pageToken=' + pageToken : ''}`;
        const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) break;
        const data = await res.json();
        if (data.items) {
          allTasks = allTasks.concat(data.items);
        }
        pageToken = data.nextPageToken; 
      } while (pageToken);
    } catch (err) {
      console.error("데이터 수집 오류:", err);
    }
    return allTasks;
  }

  async function refreshSidebarCounts() {
    if (!currentToken) return;
    try {
      const res = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
        headers: { 'Authorization': 'Bearer ' + currentToken }
      });
      const data = await res.json();
      if (!data.items) return;

      const fetchPromises = data.items.map(async list => {
        const items = await fetchAllTasks(list.id, currentToken);
        return { listId: list.id, tasks: items };
      });

      const results = await Promise.all(fetchPromises);
      let todayCount = 0;

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const todayStr = `${year}-${month}-${day}`;

      results.forEach(result => {
        const incomplete = result.tasks.filter(t => t.status !== 'completed');

        const badge = document.getElementById(`count-${result.listId}`);
        if (badge) {
          if (incomplete.length > 0) {
            badge.innerText = incomplete.length;
            badge.style.display = 'inline-block';
          } else {
            badge.style.display = 'none';
          }
        }

        const todayTasks = incomplete.filter(t => {
          if (!t.due) return false;
          const dueStr = t.due.substring(0, 10);
          return (dueStr === todayStr) || (dueStr < todayStr);
        });
        todayCount += todayTasks.length;
      });

      const todayBadge = document.getElementById('count-today');
      if (todayBadge) {
        if (todayCount > 0) {
          todayBadge.innerText = todayCount;
          todayBadge.style.display = 'inline-block';
        } else {
          todayBadge.style.display = 'none';
        }
      }
    } catch (err) {
      console.error("배지 갱신 오류", err);
    }
  }

  navToday.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
    navToday.classList.add('active');
    loadSmartList('today');
  });

  function loadTaskLists() {
    fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
      headers: { 'Authorization': 'Bearer ' + currentToken }
    })
    .then(res => res.json())
    .then(data => {
      listContainer.innerHTML = '';
      if (!data.items) return;

      data.items.forEach((list, index) => {
        const listDiv = document.createElement('div');
        if (currentListId === '' && index === 0) {
          listDiv.classList.add('active');
          listTitleEl.innerText = list.title;
          loadTasks(list.id);
          deleteListBtn.style.display = 'block';
        }

        listDiv.className = 'sidebar-item' + (listDiv.classList.contains('active') ? ' active' : '');
        listDiv.dataset.listId = list.id;
        
        listDiv.innerHTML = `
          <span class="list-name">${list.title}</span>
          <span class="task-count" id="count-${list.id}" style="display: none;"></span>
        `;
        
        listDiv.addEventListener('click', () => {
          document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
          listDiv.classList.add('active');
          listTitleEl.innerText = list.title;
          loadTasks(list.id);
          deleteListBtn.style.display = 'block';
        });

        listDiv.addEventListener('dragover', (e) => {
          e.preventDefault(); 
          const dragging = document.querySelector('.dragging');
          if (dragging && list.id !== currentListId && currentListId !== 'today') {
            listDiv.classList.add('drag-over');
          }
        });
        listDiv.addEventListener('dragleave', () => listDiv.classList.remove('drag-over'));
        listDiv.addEventListener('drop', (e) => {
          e.preventDefault();
          listDiv.classList.remove('drag-over');
          const dragging = document.querySelector('.dragging');
          if (!dragging || currentListId === 'today') return;
          
          const targetListId = list.id;
          if (targetListId === currentListId) return;

          dragging.style.display = 'none';
          const taskData = JSON.parse(dragging.dataset.taskData);
          moveTaskToAnotherList(taskData, currentListId, targetListId);
        });

        listContainer.appendChild(listDiv);
      });

      refreshSidebarCounts();
    })
    .catch(err => alert("목록 오류: " + err.message));
  }

  // 백그라운드 새로고침 지원 (isSilent 매개변수 추가)
  async function loadSmartList(type, isSilent = false) {
    currentListId = type;
    
    // 조용한 새로고침이 아닐 때만 화면을 지우고 안내문구를 띄웁니다.
    if (!isSilent) {
      listTitleEl.innerText = '☀️ 오늘 할 일';
      taskListDiv.innerHTML = "데이터를 검색 중입니다... (모든 목록을 조회하므로 약간의 시간이 소요될 수 있습니다.)";
      addTaskContainer.style.display = 'none';
      deleteListBtn.style.display = 'none';
      detailPanel.classList.remove('open');
    }

    try {
      const res = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
        headers: { 'Authorization': 'Bearer ' + currentToken }
      });
      const data = await res.json();
      if (!data.items) return;
      
      const fetchPromises = data.items.map(async list => {
        const items = await fetchAllTasks(list.id, currentToken);
        return items.map(t => ({ ...t, listId: list.id }));
      });
      
      const results = await Promise.all(fetchPromises);
      const allTasks = results.flat();
      
      let filteredTasks = [];
      
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const todayStr = `${year}-${month}-${day}`;

      filteredTasks = allTasks.filter(t => {
        if (!t.due) return false;
        const dueStr = t.due.substring(0, 10);
        return (dueStr === todayStr) || (dueStr < todayStr && t.status !== 'completed');
      });
      
      renderTaskList(filteredTasks, type);
    } catch (err) {
      if (!isSilent) alert("데이터 검색 오류: " + err.message);
    }
  }

  // 백그라운드 새로고침 지원 (isSilent 매개변수 추가)
  async function loadTasks(listId, isSilent = false) {
    currentListId = listId;
    
    // 조용한 새로고침이 아닐 때만 화면을 지웁니다.
    if (!isSilent) {
      taskListDiv.innerHTML = "할 일을 불러오는 중...";
      addTaskContainer.style.display = 'flex'; 
      detailPanel.classList.remove('open'); 
    }

    const items = await fetchAllTasks(listId, currentToken);
    items.forEach(task => task.listId = currentListId);
    renderTaskList(items, listId);
  }

  function renderTaskList(tasks, type) {
    // 백그라운드에서 데이터를 모두 가져온 뒤에만 화면을 갈아끼웁니다. (깜빡임 방지)
    taskListDiv.innerHTML = "";
    
    if (tasks.length === 0) {
      taskListDiv.innerHTML = `<p style='color:#6b7280; text-align:center;'>표시할 데이터가 없습니다.</p>`;
      return;
    }

    const incompleteGroup = document.createElement('div');
    incompleteGroup.className = 'task-group';
    const completedGroup = document.createElement('div');
    completedGroup.className = 'task-group';

    const incompleteTasks = tasks.filter(task => task.status !== 'completed');
    const completedTasks = tasks.filter(task => task.status === 'completed');

    incompleteTasks.forEach(task => renderTask(task, incompleteGroup));
    taskListDiv.appendChild(incompleteGroup);

    if (completedTasks.length > 0) {
      const divider = document.createElement('div');
      divider.innerHTML = `<h3 style="font-size: 14px; color: #6b7280; margin-top: 25px; margin-bottom: 15px; padding-bottom: 5px; border-bottom: 1px solid #e5e7eb;">완료 항목 [ ${completedTasks.length}개 ]</h3>`;
      taskListDiv.appendChild(divider);
      completedTasks.forEach(task => renderTask(task, completedGroup));
      taskListDiv.appendChild(completedGroup);
    }
  }

  function renderTask(task, container) {
    const taskDiv = document.createElement('div');
    taskDiv.className = 'task-item' + (task.status === 'completed' ? ' completed' : '');
    taskDiv.dataset.id = task.id; 
    taskDiv.dataset.listId = task.listId; 
    taskDiv.dataset.taskData = JSON.stringify(task);

    if (currentListId !== 'today') {
      taskDiv.draggable = true;
    }

    let dueHtml = '';
    if (task.due) {
      const dueDateStr = task.due.substring(0, 10);
      const dateObj = new Date(dueDateStr);
      const days = ['일', '월', '화', '수', '목', '금', '토'];
      const dayName = days[dateObj.getDay()];
      dueHtml = `<div class="task-due">📅 마감: ${dueDateStr} (${dayName})</div>`;
    }

    taskDiv.innerHTML = `
      <div class="checkbox-circle"></div>
      <div class="task-content">
        <div class="task-title">${task.title || '제목 없음'}</div>
        ${dueHtml}
      </div>
    `;
    
    if (currentListId !== 'today') {
      taskDiv.addEventListener('dragstart', () => {
        taskDiv.classList.add('dragging');
        const prev = taskDiv.previousElementSibling;
        taskDiv.dataset.startPrevId = prev ? prev.dataset.id : '';
      });
      taskDiv.addEventListener('dragend', () => {
        taskDiv.classList.remove('dragging');
        if (taskDiv.style.display === 'none') return;
        const prevElement = taskDiv.previousElementSibling;
        const newPrevId = prevElement ? prevElement.dataset.id : '';
        if (taskDiv.dataset.startPrevId !== newPrevId) {
          moveTaskOnServer(taskDiv.dataset.id, newPrevId, task.listId);
        }
      });
    }

    const checkbox = taskDiv.querySelector('.checkbox-circle');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation(); 
      toggleTaskComplete(task, taskDiv);
    });

    const titleDiv = taskDiv.querySelector('.task-content');
    titleDiv.addEventListener('click', () => {
      openDetail(task);
    });

    container.appendChild(taskDiv);
  }

  taskListDiv.addEventListener('dragover', e => {
    e.preventDefault(); 
    if (currentListId === 'today') return;
    const dragging = document.querySelector('.dragging');
    if (!dragging) return;
    const container = dragging.parentElement; 
    const afterElement = getDragAfterElement(container, e.clientY);
    if (afterElement == null) {
      container.appendChild(dragging);
    } else {
      container.insertBefore(dragging, afterElement);
    }
  });

  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.task-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function moveTaskOnServer(taskId, previousId, targetListId) {
    let url = `https://tasks.googleapis.com/tasks/v1/lists/${targetListId}/tasks/${taskId}/move`;
    if (previousId) url += `?previous=${previousId}`;
    fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + currentToken } });
  }

  function moveTaskToAnotherList(taskData, sourceListId, targetListId) {
    fetch(`https://tasks.googleapis.com/tasks/v1/lists/${targetListId}/tasks`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + currentToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: taskData.title, notes: taskData.notes, status: taskData.status, due: taskData.due })
    })
    .then(res => {
      if (!res.ok) throw new Error("복사 실패");
      return fetch(`https://tasks.googleapis.com/tasks/v1/lists/${sourceListId}/tasks/${taskData.id}`, {
        method: 'DELETE', headers: { 'Authorization': 'Bearer ' + currentToken }
      });
    })
    .then(() => { 
      refreshSidebarCounts(); 
      // 이동 후에는 깜빡임 없이 리스트만 조용히 갱신
      if (currentListId === sourceListId) loadTasks(currentListId, true); 
    })
    .catch(err => { alert("이동 중 오류: " + err.message); loadTasks(currentListId, true); });
  }

  function createNewList() {
    const title = newListInput.value.trim();
    if (!title) return;
    addListBtn.innerText = '⏳';
    newListInput.disabled = true;
    fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + currentToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title }) 
    }).then(() => {
      newListInput.value = ''; newListInput.disabled = false; addListBtn.innerText = '➕'; 
      loadTaskLists(); 
    });
  }

  addListBtn.addEventListener('click', createNewList);
  newListInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') createNewList(); });

  deleteListBtn.addEventListener('click', () => {
    if (!currentListId || currentListId === 'today') return;
    if (!confirm("⚠️ [경고] 정말 이 목록을 삭제하시겠습니까?\n모든 데이터가 영구 삭제됩니다.")) return;
    deleteListBtn.innerText = "...";
    fetch(`https://tasks.googleapis.com/tasks/v1/users/@me/lists/${currentListId}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + currentToken } })
    .then(res => {
      if (!res.ok) throw new Error("삭제 권한이 없거나 기본 목록입니다.");
      deleteListBtn.innerText = "목록 삭제"; detailPanel.classList.remove('open'); loadTaskLists(); 
    }).catch(err => { alert("실패: " + err.message); deleteListBtn.innerText = "목록 삭제"; });
  });

  function createNewTask() {
    const title = newTaskInput.value.trim();
    if (!title || !currentListId || currentListId === 'today') return;
    addTaskBtn.innerText = '...'; newTaskInput.disabled = true;
    fetch(`https://tasks.googleapis.com/tasks/v1/lists/${currentListId}/tasks`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + currentToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title }) 
    }).then(() => {
      newTaskInput.value = ''; newTaskInput.disabled = false; addTaskBtn.innerText = '추가'; newTaskInput.focus(); 
      refreshSidebarCounts(); 
      // 추가 시 화면 깜빡임 없이 조용히 갱신
      loadTasks(currentListId, true); 
    });
  }

  addTaskBtn.addEventListener('click', createNewTask);
  newTaskInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') createNewTask(); });

  function toggleTaskComplete(task, taskDiv) {
    const newStatus = task.status === 'completed' ? 'needsAction' : 'completed';
    
    // 1. 클릭 즉시 UI 변경 및 사운드 출력
    if (newStatus === 'completed') {
      taskDiv.classList.add('completed');
      playCompleteSound();
    } else {
      taskDiv.classList.remove('completed');
    }
    
    task.status = newStatus; 
    
    // 체크박스 연타 방지를 위해 잠시 비활성화
    taskDiv.style.pointerEvents = 'none';
    
    // 2. 서버로 상태 전송
    fetch(`https://tasks.googleapis.com/tasks/v1/lists/${task.listId}/tasks/${task.id}`, {
      method: 'PATCH', headers: { 'Authorization': 'Bearer ' + currentToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    }).then(() => {
      // 3. 서버 응답 성공 후, 0.6초간 기다렸다가 깜빡임 없이 화면 갱신
      setTimeout(() => {
        refreshSidebarCounts(); 
        if (currentListId === 'today') loadSmartList(currentListId, true);
        else loadTasks(currentListId, true);
      }, 600);
    }).catch(err => {
      taskDiv.style.pointerEvents = 'auto'; // 실패 시 다시 클릭 가능하도록 복구
      alert("상태 변경 실패: " + err.message);
    });
  }

  function updateDateDisplay(dateStr) {
    if (!dateStr) {
      displayDueText.innerHTML = '<span class="empty">마감일 지정 안 됨</span>';
    } else {
      const dateObj = new Date(dateStr);
      const days = ['일', '월', '화', '수', '목', '금', '토'];
      const dayName = days[dateObj.getDay()];
      displayDueText.innerHTML = `<span>${dateStr} (${dayName})</span>`;
    }
  }

  editDue.addEventListener('change', (e) => {
    updateDateDisplay(e.target.value);
  });

  editDue.addEventListener('click', function() {
    if ('showPicker' in HTMLInputElement.prototype) {
      try { this.showPicker(); } catch (err) {}
    }
  });

  closeBtn.addEventListener('click', () => { detailPanel.classList.remove('open'); currentTask = null; });

  function openDetail(task) {
    currentTask = task;
    editTitle.value = task.title || '';
    const dueStr = task.due ? task.due.substring(0, 10) : ''; 
    editDue.value = dueStr;
    updateDateDisplay(dueStr); 
    editNotes.value = task.notes ? task.notes : ''; 
    detailPanel.classList.add('open');
  }

  saveBtn.addEventListener('click', () => {
    if (!currentTask) return;
    saveBtn.innerText = "저장 중...";
    const newTitle = editTitle.value;
    const newNotes = editNotes.value;
    const newDue = editDue.value ? editDue.value + "T00:00:00.000Z" : null;

    fetch(`https://tasks.googleapis.com/tasks/v1/lists/${currentTask.listId}/tasks/${currentTask.id}`, {
      method: 'PATCH', headers: { 'Authorization': 'Bearer ' + currentToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle, notes: newNotes, due: newDue })
    }).then(() => {
      saveBtn.innerText = "저장 완료!";
      setTimeout(() => { saveBtn.innerText = "저장하기"; }, 1500);
      refreshSidebarCounts(); 
      // 저장 시에도 화면 깜빡임 없이 조용히 갱신
      if (currentListId === 'today') loadSmartList(currentListId, true);
      else loadTasks(currentListId, true);
    });
  });

  deleteBtn.addEventListener('click', () => {
    if (!currentTask) return;
    if (!confirm("⚠️ [경고] 이 작업을 영구적으로 삭제하시겠습니까?")) return;
    deleteBtn.innerText = "삭제 중...";
    fetch(`https://tasks.googleapis.com/tasks/v1/lists/${currentTask.listId}/tasks/${currentTask.id}`, {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + currentToken }
    }).then(() => {
      detailPanel.classList.remove('open');
      currentTask = null;
      deleteBtn.innerText = "삭제";
      refreshSidebarCounts(); 
      // 삭제 시에도 화면 깜빡임 없이 조용히 갱신
      if (currentListId === 'today') loadSmartList(currentListId, true);
      else loadTasks(currentListId, true);
    });
  });
});