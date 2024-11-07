export interface RcvMsg {
  id: string
  conn_id: string
  type: string
  message: undefined | string | object
}

export interface SendMsg {
  conn_id: string
  type: string
  message: undefined | string | object
}

export class WebSocketManager {
  private socketUrl: string
  private socket: WebSocket | null = null
  private isConnected: boolean = false
  private error: string | null = null
  private sendMsgQueue: SendMsg[] = []
  private connId: string = ''
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 5
  private reconnectDelay: number = 2000 // 2 seconds
  private isReconnecting: boolean = false
  private receivedMessages: Map<
    string,
    { message: RcvMsg; timestamp: number }
  > = new Map()
  private messageHandlers: { [key: string]: (message: RcvMsg) => void } = {}
  private messageRetentionPeriod: number = 2 * 60 * 1000 // 2 minutes in milliseconds
  private purgeInterval: NodeJS.Timeout | null = null

  constructor(socketUrl: string) {
    this.socketUrl = socketUrl
    this.startPurgeTimer()
  }

  private startPurgeTimer() {
    this.purgeInterval = setInterval(() => {
      const now = Date.now()
      for (const [id, { timestamp }] of this.receivedMessages) {
        if (now - timestamp > this.messageRetentionPeriod) {
          this.receivedMessages.delete(id)
        }
      }
    }, this.messageRetentionPeriod)
  }

  public registerHandler(type: string, handler: (message: RcvMsg) => void) {
    this.messageHandlers[type] = handler
  }

  public connect() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      console.warn(
        'WebSocket is already connected or in the process of connecting.',
      )
      return
    }

    this.socket = new WebSocket(this.socketUrl)

    this.socket.onopen = () => {
      this.isConnected = true
      this.error = null
      this.reconnectAttempts = 0
      console.log('WebSocket connection established')

      // Send initial connection message
      const initMsg: SendMsg = {
        conn_id: this.connId,
        type: 'connect',
        message: '',
      }
      this.send(initMsg)

      // Send any messages queued during reconnection attempts
      while (this.sendMsgQueue.length > 0) {
        const queuedMessage = this.sendMsgQueue.shift()
        if (queuedMessage) {
          this.send(queuedMessage)
        }
      }
    }

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as RcvMsg

        // Check if message ID is already in the log
        if (this.receivedMessages.has(data.id)) {
          console.warn('Duplicate message received, ignoring:', data)
          return
        }

        // Log the message by ID with a timestamp
        this.receivedMessages.set(data.id, {
          message: data,
          timestamp: Date.now(),
        })

        if (this.connId === '') {
          console.log('Setting connection ID:', data.conn_id)
          this.connId = data.conn_id
        } else if (this.connId !== data.conn_id) {
          console.error('Received message with different connection ID:', data)
          throw new Error("Connection ID doesn't match")
        }

        const handler = this.messageHandlers[data.type]
        if (handler) {
          handler(data)
        } else {
          console.warn('No handler for message type:', data.type)
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e)
      }
    }

    this.socket.onclose = () => {
      this.isConnected = false
      console.log('WebSocket connection closed')
      this.attemptReconnect()
    }

    this.socket.onerror = event => {
      this.error = 'WebSocket encountered an error'
      console.error('WebSocket error:', event)
      this.attemptReconnect()
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached. Stopping reconnection.')
      return
    }

    if (!this.isReconnecting) {
      this.isReconnecting = true
      this.reconnectAttempts++
      console.log(
        `Reconnecting attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`,
      )

      setTimeout(() => {
        console.log('Attempting to reconnect...')
        this.connect()
        this.isReconnecting = false
      }, this.reconnectDelay)
    }
  }

  public disconnect() {
    if (this.socket) {
      this.socket.close()
      this.socket = null
      this.isConnected = false
    }
    if (this.purgeInterval) {
      clearInterval(this.purgeInterval)
    }
  }

  public sendMessage(msgType: string, data: undefined | string | object) {
    const message: SendMsg = {
      conn_id: this.connId,
      type: msgType,
      message: data,
    }
    console.log('Sending message:', message)
    this.send(message)
  }

  private send(msg: SendMsg) {
    if (this.socket && this.isConnected) {
      this.socket.send(JSON.stringify(msg))
    } else {
      console.warn(
        'WebSocket is not connected. Queueing message for when connection is restored.',
      )
      this.sendMsgQueue.push(msg)
      this.connect() // Attempt to reconnect if disconnected
    }
  }
}
