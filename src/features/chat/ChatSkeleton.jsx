// Placeholder with the same layout as AI Studio, shown while the saved chats load.
export default function ChatSkeleton() {
  return (
    <div className="chat-skel" role="status" aria-label="Loading AI Studio">
      <div className="chat-skel-head">
        <span className="chat-skel-dot" />
        <div className="chat-skel-lines">
          <span className="chat-skel-line w-40" />
          <span className="chat-skel-line w-24" />
        </div>
      </div>
      <div className="chat-skel-body">
        <div className="chat-skel-msg">
          <span className="chat-skel-dot sm" />
          <div className="chat-skel-bubble">
            <span className="chat-skel-line w-70" />
            <span className="chat-skel-line w-50" />
          </div>
        </div>
        <div className="chat-skel-msg me">
          <div className="chat-skel-bubble">
            <span className="chat-skel-line w-60" />
          </div>
        </div>
      </div>
      <div className="chat-skel-composer">
        <span className="chat-skel-line w-50" />
      </div>
    </div>
  );
}
