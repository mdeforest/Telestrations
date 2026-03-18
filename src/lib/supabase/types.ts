export type RoomStatus =
  | "lobby"
  | "prompts"
  | "active"
  | "reveal"
  | "scoring"
  | "finished";

export type ScoringMode = "friendly" | "competitive";

export type EntryType = "drawing" | "guess";

export type ScoreReason =
  | "correct_guess"
  | "aided_correct"
  | "favorite_sketch"
  | "favorite_guess"
  | "chain_survived";

export type VoteType = "favorite_sketch" | "favorite_guess";

export interface Database {
  public: {
    Tables: {
      rooms: {
        Row: {
          id: string;
          code: string;
          status: RoomStatus;
          host_player_id: string | null;
          num_rounds: number;
          current_round: number;
          scoring_mode: ScoringMode;
          reveal_book_index: number;
          reveal_entry_index: number;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["rooms"]["Row"],
          "id" | "created_at"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["rooms"]["Row"],
              "id" | "created_at"
            >
          >;
        Update: Partial<Database["public"]["Tables"]["rooms"]["Insert"]>;
      };
      players: {
        Row: {
          id: string;
          room_id: string;
          nickname: string;
          seat_order: number;
          is_connected: boolean;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["players"]["Row"],
          "id" | "created_at"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["players"]["Row"],
              "id" | "created_at"
            >
          >;
        Update: Partial<Database["public"]["Tables"]["players"]["Insert"]>;
      };
      rounds: {
        Row: {
          id: string;
          room_id: string;
          round_number: number;
          current_pass: number;
          timer_started_at: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["rounds"]["Row"], "id"> &
          Partial<Pick<Database["public"]["Tables"]["rounds"]["Row"], "id">>;
        Update: Partial<Database["public"]["Tables"]["rounds"]["Insert"]>;
      };
      books: {
        Row: {
          id: string;
          round_id: string;
          owner_player_id: string;
          original_prompt: string;
        };
        Insert: Omit<Database["public"]["Tables"]["books"]["Row"], "id"> &
          Partial<Pick<Database["public"]["Tables"]["books"]["Row"], "id">>;
        Update: Partial<Database["public"]["Tables"]["books"]["Insert"]>;
      };
      entries: {
        Row: {
          id: string;
          book_id: string;
          pass_number: number;
          author_player_id: string;
          type: EntryType;
          content: string;
          submitted_at: string | null;
          is_blank: boolean;
          fuzzy_correct: boolean | null;
          owner_override: boolean | null;
        };
        Insert: Omit<Database["public"]["Tables"]["entries"]["Row"], "id"> &
          Partial<Pick<Database["public"]["Tables"]["entries"]["Row"], "id">>;
        Update: Partial<Database["public"]["Tables"]["entries"]["Insert"]>;
      };
      prompts: {
        Row: {
          id: string;
          text: string;
          category: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["prompts"]["Row"], "id"> &
          Partial<Pick<Database["public"]["Tables"]["prompts"]["Row"], "id">>;
        Update: Partial<Database["public"]["Tables"]["prompts"]["Insert"]>;
      };
      scores: {
        Row: {
          id: string;
          room_id: string;
          round_id: string;
          player_id: string;
          points: number;
          reason: ScoreReason;
        };
        Insert: Omit<Database["public"]["Tables"]["scores"]["Row"], "id"> &
          Partial<Pick<Database["public"]["Tables"]["scores"]["Row"], "id">>;
        Update: Partial<Database["public"]["Tables"]["scores"]["Insert"]>;
      };
      votes: {
        Row: {
          id: string;
          book_id: string;
          voter_player_id: string;
          entry_id: string;
          vote_type: VoteType;
        };
        Insert: Omit<Database["public"]["Tables"]["votes"]["Row"], "id"> &
          Partial<Pick<Database["public"]["Tables"]["votes"]["Row"], "id">>;
        Update: Partial<Database["public"]["Tables"]["votes"]["Insert"]>;
      };
    };
  };
}
