export interface AddRepoDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (repoId: string) => void;
}
