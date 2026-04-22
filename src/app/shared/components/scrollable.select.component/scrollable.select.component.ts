import { ChangeDetectionStrategy, Component, input, output, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { EventHelpers } from '../../../helpers/EventHelpers';


@Component({
  selector: 'app-scrollable-select-component',
  imports: [FormsModule, MatIcon],
  templateUrl: './scrollable.select.component.html',
  styleUrl: './scrollable.select.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush // Using OnPush to optimize performance so external parent won't unnecessarily trigger for the changes they are not concerned with
})
export class ScrollableSelectComponent {

  eventHelpers = EventHelpers;

  activeValue = input<string | null>(null);
  optionValues = input<string[]>([]);
  verticalPosition = input<number>(30);
  modalWidth = input<number | null>(null);
  modalHeight = input<number>(250);
  absoluteStartLeft = input<boolean | number>(true);
  searchable = input<boolean>(false);
  itemColor = input<(item: string) => string>(() => 'inherit');
  activeItemColor = input<(item: string) => string>(() => 'var(--postonsteroids-accent)');
  uppercase = input<boolean>(false);
  manualState = input<boolean | undefined>(undefined);
  scrollableSelectState = signal<boolean>(false);
  searchQuery = signal<string>('');
  outputSelectedValue = output<string>();

  leftPosition = computed(() => {
    const val = this.absoluteStartLeft();
    if (typeof val === 'number') return val + 'px';
    return val ? '0px' : 'auto';
  });

  rightPosition = computed(() => {
    const val = this.absoluteStartLeft();
    if (typeof val === 'number') return 'auto';
    return val ? 'auto' : '0px';
  });


  shoutoptions = computed(() => {
    let ot = this.optionValues();
    alert(JSON.stringify(ot));
  });


  filteredOptions = computed(() => {
    const query = this.searchQuery().toLowerCase();
    if (!query) return this.optionValues();
    return this.optionValues().filter(v => v.toLowerCase().includes(query));
  });

  setActiveValue(value: string) {
    this.outputSelectedValue.emit(value);
    this.toggleScrollableSelectState(false);
  }

  onBlur(event: FocusEvent) {
    const target = event.relatedTarget as HTMLElement;
    const currentTarget = event.currentTarget as HTMLElement;
    if (target && currentTarget.contains(target)) {
      return;
    }
    this.toggleScrollableSelectState(false);
  }

  toggleScrollableSelectState(stateValue: boolean) {
    this.scrollableSelectState.set(stateValue);
    if (!stateValue) {
      this.searchQuery.set('');
    }
  }

}
