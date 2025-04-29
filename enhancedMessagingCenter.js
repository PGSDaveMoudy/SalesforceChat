// enhancedMessagingCenter.js
import { LightningElement, api, track } from 'lwc';
import { subscribe, unsubscribe, onError } from 'lightning/empApi';
import getChatRooms   from '@salesforce/apex/EnhancedMessagingCenterController.getChatRooms';
import getMessages    from '@salesforce/apex/EnhancedMessagingCenterController.getMessages';
import sendMessage    from '@salesforce/apex/EnhancedMessagingCenterController.sendMessage';
import createChatRoom from '@salesforce/apex/EnhancedMessagingCenterController.createChatRoom';

export default class EnhancedMessagingCenter extends LightningElement {
  @api defaultChatRoomId;

  @track chatRoomOptions   = [];
  @track selectedRoomId    = '';
  @track messages          = [];
  @track showNewRoomForm   = false;
  @track newMessageCount   = 0;

  newBody        = '';
  newRoomName    = '';
  newRoomDesc    = '';
  newRoomPrivate = false;

  channelName = '/data/Chat_Message__ChangeEvent';
  subscription;

  connectedCallback() {
    this.initializeComponent();
  }

  disconnectedCallback() {
    if (this.subscription) {
      unsubscribe(this.subscription)
        .catch(err => console.error('[EMC] unsubscribe error', err));
    }
  }

  async initializeComponent() {
    try {
      const rooms = await getChatRooms();
      this.chatRoomOptions = rooms.map(r => ({ label: r.Name, value: r.Id }));
      this.selectedRoomId = this.defaultChatRoomId
                         || this.chatRoomOptions[0]?.value
                         || '';
      await this.loadMessages();
      this.subscribeToCDC();
    } catch (e) {
      console.error('[EMC] init error', e);
    }
  }

  async loadMessages() {
    if (!this.selectedRoomId) {
      this.messages = [];
      return;
    }
    try {
      const msgs = await getMessages({ roomId: this.selectedRoomId });
      this.messages = msgs.map(m => ({
        ...m,
        senderName: m.Sender__r?.Name || 'Unknown'
      }));
      this.scrollToBottom();
      // reset the bell when we load (user has seen them)
      this.newMessageCount = 0;
    } catch (e) {
      console.error('[EMC] loadMessages error', e);
    }
  }

  subscribeToCDC() {
    onError(err => console.error('[EMC] CDC error', err));
    subscribe(this.channelName, -1, this.handleMessageEvent.bind(this))
      .then(sub => this.subscription = sub)
      .catch(err => console.error('[EMC] subscribe error', err));
  }

  async handleMessageEvent(event) {
    const hdr    = event.data.payload.ChangeEventHeader;
    const change = hdr.changeType;
    const recId  = hdr.recordIds[0];
    const roomId = event.data.payload.Chat_Room__c;

    if (change === 'CREATE' && roomId === this.selectedRoomId) {
      // only reload if it's not one we already appended
      if (!this.messages.some(m => m.Id === recId)) {
        this.newMessageCount++;
        await this.loadMessages();
      }
    }
  }

  // ——— render a bell with badge in your header ———
  handleBellClick() {
    this.newMessageCount = 0;
  }

  // ——— send a message ———
  async handleSend() {
    const body = (this.newBody||'').trim();
    if (!body) return;
    try {
      const msg = await sendMessage({ roomId: this.selectedRoomId, body });
      this.messages = [
        ...this.messages,
        { ...msg, senderName: msg.Sender__r?.Name || 'Unknown' }
      ];
      this.newBody = '';
      this.template.querySelector('lightning-input-rich-text').setContent('');
      this.scrollToBottom();
    } catch (e) {
      console.error('[EMC] sendMessage error', e);
    }
  }

  // ——— create & switch rooms ———
  toggleNewRoomForm() {
    this.showNewRoomForm = !this.showNewRoomForm;
  }
  handleRoomFieldChange(e) {
    const f = e.target.dataset.field;
    this[f] = e.target.type==='toggle' ? e.target.checked : e.target.value;
  }
  get createDisabled() {
    return !this.newRoomName.trim();
  }
  async handleCreateRoom() {
    try {
      const room = await createChatRoom(
        this.newRoomName,
        this.newRoomPrivate,
        this.newRoomDesc
      );
      this.chatRoomOptions = [
        ...this.chatRoomOptions,
        { label: room.Name, value: room.Id }
      ];
      this.selectedRoomId  = room.Id;
      this.showNewRoomForm = false;
      this.newRoomName = this.newRoomDesc = '';
      this.newRoomPrivate = false;
      await this.loadMessages();
    } catch (e) {
      console.error('[EMC] createChatRoom error', e);
    }
  }
  async handleRoomChange(e) {
    const newRoom = e.currentTarget.dataset.id;
    if (newRoom && newRoom !== this.selectedRoomId) {
      this.selectedRoomId = newRoom;
      await this.loadMessages();
    }
  }

  // ——— helpers ———
  handleInput(e) {
    this.newBody = e.detail.value;
  }
  handleKeyUp(e) {
    if (e.key==='Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  }
  scrollToBottom() {
    setTimeout(() => {
      const c = this.template.querySelector('.messages');
      if (c) c.scrollTop = c.scrollHeight;
    }, 50);
  }

  // ——— rendering ———
  get roomsWithClass() {
    return this.chatRoomOptions.map(r => ({
      ...r,
      className: r.value===this.selectedRoomId?'room active':'room'
    }));
  }
  get currentRoomName() {
    return this.chatRoomOptions.find(r=>r.value===this.selectedRoomId)?.label
      || 'Messaging Center';
  }
}