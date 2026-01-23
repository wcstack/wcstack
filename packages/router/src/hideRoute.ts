import { IRoute } from "./components/types";

export function hideRoute(route: IRoute) {
  route.clearParams();
  for(const node of route.childNodeArray) {
    node.parentNode?.removeChild(node);
  }
}
