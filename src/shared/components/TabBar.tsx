import { useDispatchStore } from "../../app/providers";
import { tabDefinitions } from "../../store/uiSlice";

export function TabBar() {
  const activeTab = useDispatchStore((state) => state.activeTab);
  const setActiveTab = useDispatchStore((state) => state.setActiveTab);

  return (
    <div className="border-b border-white/8 px-3 py-3 sm:px-4">
      <div className="flex flex-wrap gap-2">
        {tabDefinitions.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="dispatch-tab rounded-full px-4 py-2 text-sm font-medium transition"
            data-active={tab.id === activeTab}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
